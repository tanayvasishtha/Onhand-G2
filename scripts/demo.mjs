// One command, no keys: starts the app and opens the Even Hub simulator on a
// scripted client. Each hold and release on the ring plays the next line.
//   npm run demo            (Dubai units)
//   npm run demo -- menu    (restaurant menu, or cars)
import { spawn } from 'node:child_process'

const script = process.argv[2] ?? 'hero'
const port = 5173
const url = `http://localhost:${port}/?replay=${script}`
// Windows needs a shell to find npm and npx; pass one command string there.
const run = (cmd, args) =>
  process.platform === 'win32'
    ? spawn([cmd, ...args.map(a => `"${a}"`)].join(' '), { stdio: 'inherit', shell: true })
    : spawn(cmd, args, { stdio: 'inherit' })

const app = run('npm', ['run', 'dev', '-w', 'app', '--', '--port', String(port), '--strictPort'])
const ready = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/`)).ok) return true
    } catch {}
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}
if (!(await ready())) {
  console.error(`app did not start on port ${port}`)
  app.kill()
  process.exit(1)
}
console.log(`\napp ready at ${url}\nopening the simulator: long press the ring to hear the next client line\n`)
const sim = run('npx', ['evenhub-simulator', url])
const stop = () => {
  sim.kill()
  app.kill()
  process.exit(0)
}
sim.on('exit', stop)
process.on('SIGINT', stop)
