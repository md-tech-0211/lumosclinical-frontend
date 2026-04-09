import type { Metadata } from 'next'
import { Poppins } from 'next/font/google'
import { AppShell } from '@/components/app-shell'
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
    <html
      lang="en"
      className={`${poppins.variable} dark h-full overflow-hidden`}
      suppressHydrationWarning
    >
      <body className="font-sans h-full min-h-0 overflow-hidden bg-background text-foreground luna-app-bg">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} forcedTheme="dark">
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  )
}
