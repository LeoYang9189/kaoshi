import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: '航标 · 国际货代模拟考试', description: '历年国际货代真题、限时模拟考试与多人学习档案。记录每一次练习，看见每一步进步。', icons: { icon: '/favicon.svg' } };
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>) { return <html lang="zh-CN"><body>{children}</body></html>; }
