import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function readAppVersion() {
    try {
        const version = readFileSync(join(projectRoot, 'VERSION'), 'utf-8').trim()
        return version || '0.0.0'
    } catch {
        return '0.0.0'
    }
}

const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || readAppVersion()
const appBasePath = (() => {
    const trimmed = String(process.env.NEXT_PUBLIC_BASE_PATH || '').trim()
    if (!trimmed || trimmed === '/') {
        return ''
    }
    return `/${trimmed.replace(/^\/+|\/+$/g, '')}`
})()

const nextConfig: NextConfig = {
    allowedDevOrigins: ['127.0.0.1'],
    basePath: appBasePath || undefined,
    env: {
        NEXT_PUBLIC_APP_VERSION: appVersion,
        NEXT_PUBLIC_BASE_PATH: appBasePath,
    },
    output: 'export',
    trailingSlash: true,
    images: {
        unoptimized: true,
    },
    typescript: {
        ignoreBuildErrors: true,
    },
}

export default nextConfig
