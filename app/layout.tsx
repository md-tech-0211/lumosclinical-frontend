import type { Metadata } from 'next'
import { Poppins } from 'next/font/google'
import Image from 'next/image'
import Link from 'next/link'

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
    <html lang="en" className={poppins.variable}>
      <body className="font-sans antialiased min-h-screen flex flex-col bg-background text-foreground">
        <header className="border-b border-border bg-background">
          
        </header>
        <main className="flex-1 flex flex-col">
          {children}
        </main>
      </body>
    </html>
  )
}
