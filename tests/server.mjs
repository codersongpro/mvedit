/**
 * e2e 공통 미리보기 서버.
 *
 * 포트를 고정하면 앞선 실행이 남긴 서버나 다른 도구와 부딪혀
 * "서버가 뜨지 않았습니다"만 남고 원인을 알 수 없다. 그래서
 *   - 빈 포트를 그때그때 받아 쓰고 (PORT 를 주면 그 값을 쓴다)
 *   - npx 가 아니라 vite 실행 파일을 직접 띄워 자식이 남지 않게 하고
 *   - 서버가 뱉은 오류를 실패 메시지에 붙인다.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/** 커널이 비어 있다고 알려준 포트를 받는다. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

export async function startPreviewServer({ attempts = 40 } = {}) {
  const port = Number(process.env.PORT ?? (await freePort()))
  const baseUrl = `http://127.0.0.1:${port}/`

  const bin = join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  const server = spawn(process.execPath, [bin, 'preview', '--port', String(port), '--strictPort'], {
    cwd: projectRoot,
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  })

  let stderr = ''
  server.stderr.setEncoding('utf8')
  server.stderr.on('data', (chunk) => {
    stderr += chunk
  })

  const stop = () => {
    try {
      process.kill(-server.pid, 'SIGKILL')
    } catch {
      server.kill('SIGKILL')
    }
  }

  for (let i = 0; i < attempts; i += 1) {
    try {
      if ((await fetch(baseUrl)).ok) return { baseUrl, port, stop }
    } catch {
      /* 아직 안 떴다 */
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  stop()
  throw new Error(
    `미리보기 서버가 ${baseUrl} 에서 뜨지 않았습니다.` +
      (stderr.trim() ? `\n서버 출력:\n${stderr.trim()}` : ' (서버 출력 없음)'),
  )
}
