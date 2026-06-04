import './globals.css'
import LayoutWrapper from '@/components/LayoutWrapper'

export const metadata = {
  title: 'Inversiones Hnos Liñan',
  description: 'Gestión de préstamos, carteras mixtas y empeños',
}

export default function RootLayout({ children }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="bg-gray-50 text-gray-900" suppressHydrationWarning>
        <LayoutWrapper>{children}</LayoutWrapper>
      </body>
    </html>
  )
}
