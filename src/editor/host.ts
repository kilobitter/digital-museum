/** The dev write API only accepts loopback requests, so saving only works from this computer. */
export const isLoopbackHost = (hostname: string) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname.toLowerCase());

/** Where to open the editor to be able to save. */
export const localEditorUrl = (port: string) => `https://localhost${port ? `:${port}` : ''}/editor.html`;
