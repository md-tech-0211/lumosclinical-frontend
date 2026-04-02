import type { Metadata } from 'next'
import { Poppins } from 'next/font/google'
import Image from 'next/image'
import Link from 'next/link'
import { ThemeProvider } from '@/components/theme-provider'

import './globals.css'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Lumos Clinical',
  description: 'Patient-focused mental health care in San Jose and Los Gatos, CA.',
  generator: 'v0.app',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={poppins.variable} suppressHydrationWarning>
      <body className="font-sans antialiased min-h-screen bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <div className="min-h-screen flex flex-col">
            <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur">
              <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
                <div className="flex h-14 items-center justify-between gap-3">
                  <Link href="/" className="flex items-center gap-3">
                    <Image
                      src="/assets/logo/logo.jpg"
                      alt="Lumos Clinical"
                      width={96}
                      height={32}
                      className="h-8 w-auto object-contain"
                      priority
                    />
                    <span className="hidden sm:inline text-sm font-semibold tracking-tight">
                      Lumos Clinical
                    </span>
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    Monday Assistant
                  </div>
                </div>
              </div>
            </header>
            <main className="flex-1">
              <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-6">
                {children}
              </div>
            </main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
