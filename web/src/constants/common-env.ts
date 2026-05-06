function normalizeBasePath(value: string | undefined) {
    const trimmed = String(value || '').trim()
    if (!trimmed || trimmed === '/') {
        return ''
    }
    return `/${trimmed.replace(/^\/+|\/+$/g, '')}`
}

const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH)

const webConfig = {
    apiUrl: process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:8000' : basePath,
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0',
    basePath,
    loginPath: `${basePath}/login`,
    withBasePath(path: string) {
        const normalizedPath = path.startsWith('/') ? path : `/${path}`
        return `${basePath}${normalizedPath}`
    },
}

export default webConfig
