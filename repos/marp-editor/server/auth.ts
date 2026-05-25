import { betterAuth } from 'better-auth'
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node'
import { username } from 'better-auth/plugins/username'
import { google } from 'better-auth/social-providers'
import { getDb } from './db.js'

const db = getDb()

export const auth = betterAuth({
  database: db,
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3001',
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  plugins: [
    username(),
  ],
  socialProviders: {
    google: process.env.IDP_GOOGLE_TECHDECK_CLIENT_ID && process.env.IDP_GOOGLE_TECHDECK_CLIENT_SECRET
      ? google({
          clientId: process.env.IDP_GOOGLE_TECHDECK_CLIENT_ID,
          clientSecret: process.env.IDP_GOOGLE_TECHDECK_CLIENT_SECRET,
        })
      : undefined,
  },
})

export { toNodeHandler, fromNodeHeaders }
