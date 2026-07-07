import '@/styles/globals.css'
import type { AppProps } from 'next/app'
import type { NextPage } from 'next'
import type { ReactElement, ReactNode } from 'react'

// Pages under /admin attach getLayout so AdminLayout (sidebar + the
// permission check that fetches the profile) mounts once and persists
// across navigations instead of remounting — without this every tab click
// tore down and rebuilt the whole sidebar, which looked and felt like a
// full page reload even though it was client-side routing.
export type NextPageWithLayout = NextPage & {
  getLayout?: (page: ReactElement) => ReactNode
}
type AppPropsWithLayout = AppProps & {
  Component: NextPageWithLayout
}

export default function App({ Component, pageProps }: AppPropsWithLayout) {
  const getLayout = Component.getLayout ?? ((page: ReactElement) => page)
  return getLayout(<Component {...pageProps} />)
}
