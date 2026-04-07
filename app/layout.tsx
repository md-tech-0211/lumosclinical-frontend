import type { Metadata } from 'next'
import { Poppins } from 'next/font/google'
import Image from 'next/image'
import Link from 'next/link'
import { NavNewChatLink } from '@/components/nav-new-chat-link'
import { SidebarRecentChats } from '@/components/sidebar-recent-chats'
import { ThemeProvider } from '@/components/theme-provider'
import { ThemeToggle } from '@/components/theme-toggle'

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
    <html lang="en" className={`${poppins.variable} h-full overflow-hidden`} suppressHydrationWarning>
      <body className="font-sans h-full min-h-0 overflow-hidden bg-background text-foreground luna-app-bg">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <header className="z-50 shrink-0 border-b border-border/50 bg-white/80 shadow-[0_1px_0_0_hsl(var(--border)/0.5)] backdrop-blur-xl supports-[backdrop-filter]:bg-white/70 dark:border-border/40 dark:bg-card/30 dark:shadow-none dark:supports-[backdrop-filter]:bg-card/20">
              <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/25 to-transparent" />
              <div className="w-full px-0 sm:px-4">
                <div className="flex h-[3.25rem] items-center justify-between gap-3">
                  <Link
                    href="/"
                    className="group flex items-center rounded-xl py-1 pr-2 transition-opacity hover:opacity-90"
                  >
                    <span className="relative">
                      <span className="absolute -inset-1 rounded-lg bg-gradient-to-br from-primary/25 to-chart-3/20 opacity-0 blur-md transition-opacity group-hover:opacity-100" />
                      <Image
                        src="/assets/logo/lo.jpeg"
                        alt="Luna Clinical"
                        width={96}
                        height={32}
                        className="relative rounded-[5px] object-contain drop-shadow-sm"
                        style={{ width: 'auto', height: '2rem' }}
                        priority
                      />
                    </span>
                    <span className="ml-3 text-sm font-semibold tracking-tight text-foreground">
                      AI Assistant
                    </span>
                  </Link>
                  <div className="flex items-center gap-1">
                    <ThemeToggle />
                  </div>
                </div>
              </div>
            </header>
            <main className="min-h-0 flex-1 overflow-hidden">
              <div className="flex h-full min-h-0 flex-col px-0 py-4 sm:px-4 sm:py-6">
                <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
                  <aside className="hidden min-h-0 w-64 shrink-0 flex-col overflow-hidden md:flex">
                    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-b from-card via-card to-secondary/30 shadow-[0_8px_30px_-8px_hsl(var(--primary)/0.12),0_0_0_1px_hsl(var(--border)/0.35)] backdrop-blur-md dark:border-border/50 dark:bg-card/25 dark:[background-image:none] dark:shadow-none dark:backdrop-blur-sm">
                      <div className="shrink-0 space-y-1 p-2">
                        <NavNewChatLink className="!w-full !justify-start !rounded-xl !px-3 !py-2 hover:bg-muted/80" />
                      </div>
                      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2 [scrollbar-gutter:stable]">
                        <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          Recent
                        </p>
                        <SidebarRecentChats />
                      </div>
                    </div>
                  </aside>
                  <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    {children}
                  </section>
                </div>
              </div>
            </main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
