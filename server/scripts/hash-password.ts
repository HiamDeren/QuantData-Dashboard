import { hashPassword } from '../auth.js'

const password = process.argv[2]

if (!password) {
  console.error('Usage: npm run hash-password -- "<your password>"')
  process.exit(1)
}

console.log(`AUTH_PASSWORD_HASH=${hashPassword(password)}`)
