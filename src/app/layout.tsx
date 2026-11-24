import type { Metadata } from 'next';
import './globals.css';
import { ToastProvider } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';

export const metadata: Metadata = {
  title: 'AI Relay — Personal AI API Gateway',
  description: '轻量、开箱即用的个人 AI API 网关。支持 Cloudflare Workers / Vercel 一键部署、Docker 自部署与本地 CLI，无需预设环境变量，打开 /admin 即可初始化使用。',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body style={{
        margin: 0,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        backgroundColor: '#0a0a0f',
        color: '#e0e0e0',
      }}>
        <ErrorBoundary>
          <ToastProvider>
            {children}
          </ToastProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
