import { client as dgraphClient } from "./client"
import { format } from "./utils"
import type { Adapter } from "next-auth/adapters"
import type { DgraphClientParams } from "./client"
import * as defaultFragments from "./graphql/fragments"

export type { DgraphClientParams, DgraphClientError } from "./client"

type Transformer<I = any, R = any> = (x: I) => R

export interface DgraphAdapterOptions {
  fragments?: {
    User?: string
    Account?: string
    Session?: string
    VerificationToken?: string
  }
  transformers?: Partial<{ [x: keyof Adapter]: Transformer }>
}

export { format }

export function DgraphAdapter(
  client: DgraphClientParams,
  options?: DgraphAdapterOptions
): Adapter {
  const c = dgraphClient(client)
  const change = <T>(func: keyof Adapter, x: T) =>
    options?.transformers?.[func]?.(x) ?? x

  const fragments = { ...defaultFragments, ...options?.fragments }
  return {
    async createUser(input) {
      const result = await c.run<{ user: any[] }>(
        /* GraphQL */ `
          mutation ($input: [AddUserInput!]!) {
            addUser(input: $input) {
              user {
                ...UserFragment
              }
            }
          }
          ${fragments.User}
        `,
        {
          input: change("createUser", input),
        }
      )

      return format.from<any>(result?.user[0])
    },
    async getUser(id) {
      const result = await c.run<any>(
        /* GraphQL */ `
          query ($id: ID!) {
            getUser(id: $id) {
              ...UserFragment
            }
          }
          ${fragments.User}
        `,
        { id: change("getUser", id) }
      )

      return format.from<any>(result)
    },
    async getUserByEmail(email) {
      const [user] = await c.run<any>(
        /* GraphQL */ `
          query ($email: String = "") {
            queryUser(filter: { email: { eq: $email } }) {
              ...UserFragment
            }
          }
          ${fragments.User}
        `,
        { email: change("getUserByEmail", email) }
      )
      return format.from<any>(user)
    },
    async getUserByAccount(provider_providerAccountId) {
      const [account] = await c.run<any>(
        /* GraphQL */ `
          query ($providerAccountId: String = "", $provider: String = "") {
            queryAccount(
              filter: {
                and: {
                  providerAccountId: { eq: $providerAccountId }
                  provider: { eq: $provider }
                }
              }
            ) {
              user {
                ...UserFragment
              }
              id
            }
          }
          ${fragments.User}
        `,
        change("getUserByAccount", provider_providerAccountId)
      )
      return format.from<any>(account?.user)
    },
    async updateUser({ id, ...input }) {
      const result = await c.run<any>(
        /* GraphQL */ `
          mutation ($id: [ID!] = "", $input: UserPatch) {
            updateUser(input: { filter: { id: $id }, set: $input }) {
              user {
                ...UserFragment
              }
            }
          }
          ${fragments.User}
        `,
        change("updateUser", { id, input })
      )
      return format.from<any>(result.user[0])
    },
    async deleteUser(id) {
      const result = await c.run<any>(
        /* GraphQL */ `
          mutation ($id: [ID!] = "") {
            deleteUser(filter: { id: $id }) {
              numUids
              user {
                accounts {
                  id
                }
                sessions {
                  id
                }
              }
            }
          }
        `,
        { id: change("deleteUser", id) }
      )

      const deletedUser = format.from<any>(result.user[0])

      await c.run<any>(
        /* GraphQL */ `
          mutation ($accounts: [ID!], $sessions: [ID!]) {
            deleteAccount(filter: { id: $accounts }) {
              numUids
            }
            deleteSession(filter: { id: $sessions }) {
              numUids
            }
          }
        `,
        {
          sessions: deletedUser.sessions.map((x: any) => x.id),
          accounts: deletedUser.accounts.map((x: any) => x.id),
        }
      )

      return deletedUser
    },

    async linkAccount(data) {
      const { userId, ...input } = data
      await c.run<any>(
        /* GraphQL */ `
          mutation ($input: [AddAccountInput!]!) {
            addAccount(input: $input) {
              account {
                ...AccountFragment
              }
            }
          }
          ${fragments.Account}
        `,
        { input: change("linkAccount", { ...input, user: { id: userId } }) }
      )
      return data
    },
    async unlinkAccount(provider_providerAccountId) {
      await c.run<any>(
        /* GraphQL */ `
          mutation ($providerAccountId: String = "", $provider: String = "") {
            deleteAccount(
              filter: {
                and: {
                  providerAccountId: { eq: $providerAccountId }
                  provider: { eq: $provider }
                }
              }
            ) {
              numUids
            }
          }
        `,
        change("unlinkAccount", provider_providerAccountId)
      )
    },

    async getSessionAndUser(sessionToken) {
      const [sessionAndUser] = await c.run<any>(
        /* GraphQL */ `
          query ($sessionToken: String = "") {
            querySession(filter: { sessionToken: { eq: $sessionToken } }) {
              ...SessionFragment
              user {
                ...UserFragment
              }
            }
          }
          ${fragments.User}
          ${fragments.Session}
        `,
        { sessionToken: change("getSessionAndUser", sessionToken) }
      )
      if (!sessionAndUser) return null

      const { user, ...session } = sessionAndUser

      return {
        user: format.from<any>(user),
        session: { ...format.from<any>(session), userId: user.id },
      }
    },
    async createSession(data) {
      const { userId, ...input } = options?.transformers?.createSession
        ? options?.transformers?.createSession(data)
        : data

      await c.run<any>(
        /* GraphQL */ `
          mutation ($input: [AddSessionInput!]!) {
            addSession(input: $input) {
              session {
                ...SessionFragment
              }
            }
          }
          ${fragments.Session}
        `,
        { input: change("createSession", { ...input, user: { id: userId } }) }
      )

      return data as any
    },
    async updateSession({ sessionToken, ...input }) {
      const result = await c.run<any>(
        /* GraphQL */ `
          mutation ($input: SessionPatch = {}, $sessionToken: String) {
            updateSession(
              input: {
                filter: { sessionToken: { eq: $sessionToken } }
                set: $input
              }
            ) {
              session {
                ...SessionFragment
                user {
                  id
                }
              }
            }
          }
          ${fragments.Session}
        `,
        change("updateSession", { sessionToken, input })
      )
      const session = format.from<any>(result.session[0])

      if (!session?.user?.id) return null

      return { ...session, userId: session.user.id }
    },
    async deleteSession(sessionToken) {
      await c.run<any>(
        /* GraphQL */ `
          mutation ($sessionToken: String = "") {
            deleteSession(filter: { sessionToken: { eq: $sessionToken } }) {
              numUids
            }
          }
        `,
        { sessionToken: change("deleteSession", sessionToken) }
      )
    },

    async createVerificationToken(input) {
      const result = await c.run<any>(
        /* GraphQL */ `
          mutation ($input: [AddVerificationTokenInput!]!) {
            addVerificationToken(input: $input) {
              numUids
            }
          }
        `,
        { input: change("createVerificationToken", input) }
      )
      return format.from<any>(result)
    },

    async useVerificationToken(params) {
      const result = await c.run<any>(
        /* GraphQL */ `
          mutation ($token: String = "", $identifier: String = "") {
            deleteVerificationToken(
              filter: {
                and: { token: { eq: $token }, identifier: { eq: $identifier } }
              }
            ) {
              verificationToken {
                ...VerificationTokenFragment
              }
            }
          }
          ${fragments.VerificationToken}
        `,
        change("useVerificationToken", params)
      )

      return format.from<any>(result.verificationToken[0])
    },
  }
}
