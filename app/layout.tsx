import type { Metadata } from 'next'
import { Poppins } from 'next/font/google'
import Image from 'next/image'
import Link from 'next/link'
import { NavNewChatLink } from '@/components/nav-new-chat-link'
import { ThemeProvider } from '@/components/theme-provider'

import './globals.css'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Luna Clinical',
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
      <body className="font-sans min-h-screen bg-background text-foreground luna-app-bg">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <div className="min-h-screen flex flex-col">
            <header className="sticky top-0 z-50 border-b border-border/40 bg-card/30 backdrop-blur-xl supports-[backdrop-filter]:bg-card/20">
              <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/25 to-transparent" />
              <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
                <div className="flex h-[3.25rem] items-center justify-between gap-3">
                  <Link
                    href="/"
                    className="group flex items-center gap-3 rounded-xl py-1 pr-2 transition-opacity hover:opacity-90"
                  >
                    <span className="relative">
                      <span className="absolute -inset-1 rounded-lg bg-gradient-to-br from-primary/25 to-chart-3/20 opacity-0 blur-md transition-opacity group-hover:opacity-100" />
                      <Image
                        src="/assets/logo/logo.jpg"
                        alt="Luna Clinical"
                        width={96}
                        height={32}
                        className="relative h-8 w-auto object-contain drop-shadow-sm"
                        priority
                      />
                    </span>
                    <span className="hidden text-sm font-semibold tracking-tight text-foreground sm:inline">
                      Luna Clinical
                    </span>
                  </Link>
                  <nav className="flex items-center gap-1.5 rounded-full border border-border/50 bg-background/50 p-1 text-sm shadow-sm backdrop-blur-sm dark:bg-background/30">
                    <NavNewChatLink className="!rounded-full !px-3 !py-1.5 hover:bg-muted/80" />
                    <Link
                      href="/chats"
                      className="rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
                    >
                      Previous chat
                    </Link>
                  </nav>
                </div>
              </div>
            </header>
            <main className="flex-1">
              <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
                {children}
              </div>
            </main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
