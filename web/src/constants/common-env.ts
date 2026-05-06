function normalizeBasePath(value: string | undefined) {
    const trimmed = String(value || '').trim()
    if (!trimmed || trimmed === '/') {
        return ''
    }
    return `/${trimmed.replace(/^\/+|\/+$/g, '')}`
}

function normalizePathname(pathname: string, basePath: string) {
    const rawPath = String(pathname || '').trim() || '/'
    const withoutQuery = rawPath.split('?')[0] || '/'
    const strippedBasePath = basePath && withoutQuery.startsWith(basePath)
        ? withoutQuery.slice(basePath.length) || '/'
        : withoutQuery
    const normalizedPath = strippedBasePath.startsWith('/') ? strippedBasePath : `/${strippedBasePath}`
    if (normalizedPath.length > 1) {
        return normalizedPath.replace(/\/+$/, '')
    }
    return normalizedPath
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
    normalizePathname(pathname: string) {
        return normalizePathname(pathname, basePath)
    },
}

export default webConfig
