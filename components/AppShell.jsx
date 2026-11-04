'use client';
import Link from 'next/link';
import {usePathname,useRouter} from 'next/navigation';
import {useState} from 'react';
const tabs=[['/my-games','MY GAMES'],['/library','LIBRARY'],['/install','INSTALL'],['/admin','ADMIN']];
export default function AppShell({children}){
 const path=usePathname(),router=useRouter();const [query,setQuery]=useState('');
 return <><header className="topbar"><Link href="/my-games" className="brand" aria-label="CloudPlay Home"><span className="brand-mark">◉</span><span>CLOUDPLAY</span><em>ALPHA</em></Link><form className="header-search" role="search" onSubmit={e=>{e.preventDefault();router.push(`/library?q=${encodeURIComponent(query.trim())}`)}}><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索游戏..." aria-label="搜索游戏"/><button type="submit" aria-label="提交搜索">⌕</button></form><Link className="icon-btn" href="/p0" title="真实串流验证">◉</Link><div className="profile"><span className="avatar">CP</span><span>体验模式</span></div></header><main className="main"><div className="top-row"><nav className="tabs" aria-label="主导航">{tabs.map(([href,label])=><Link key={href} href={href} className={`tab ${path===href||path.startsWith(href+'/')?'active':''}`}>{label}</Link>)}</nav><div className="top-hint">WEB CLOUD GAMING <span className="dot"/> P0 / P1</div></div>{children}<footer className="footer">CLOUDPLAY · P1 ENGINEERING SCAFFOLD · DEMO ARTWORK FOR UI REFERENCE ONLY · NO LIVE GPU SESSIONS</footer></main><nav className="mobile-nav" aria-label="移动主导航">{tabs.map(([href,label])=><Link key={href} className={path.startsWith(href)?'active':''} href={href}>{label==='MY GAMES'?'我的游戏':label==='LIBRARY'?'游戏库':label==='INSTALL'?'安装':'管理'}</Link>)}</nav></>
}
