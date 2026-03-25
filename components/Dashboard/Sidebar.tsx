"use client"

import { MessageSquare, FolderKanban, Users, Settings, LogOut, User as UserIcon, CreditCard } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import Image from "next/image"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useState, useEffect } from "react"
import pb from "@/lib/pocketbase"
import FaviconWhite from "@/assets/FaviconWhite.png"
import FaviconBlack from "@/assets/FaviconBlack.png"

const allNavItems = [
  { icon: MessageSquare, label: "Chat", href: "/chat" },
  { icon: FolderKanban, label: "Projects", href: "/projects" },
  { icon: Users, label: "Team", href: "/team" },
  { icon: CreditCard, label: "Subscription", href: "/subscription" },
  { icon: Settings, label: "Settings", href: "/settings" },
]

interface User {
  id: string
  email: string
  name: string
  username: string
  avatar?: string
}

export function Sidebar() {
  const pathname = usePathname()
  const { theme } = useTheme()
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [isTeamMember, setIsTeamMember] = useState(false)

  useEffect(() => {
    setMounted(true)
    fetchUserData()
    
    // Listen for auth changes
    const unsubscribe = pb.authStore.onChange(() => {
      fetchUserData()
    })
    
    return () => {
      unsubscribe()
    }
  }, [])

  const fetchUserData = async () => {
    try {
      const authModel = pb.authStore.model
      
      if (!authModel) {
        setUser(null)
        return
      }

      // Get user data from authStore or fetch from API
      const userData: User = {
        id: authModel.id,
        email: authModel.email || '',
        name: authModel.name || authModel.username || 'User',
        username: authModel.username || '',
        avatar: authModel.avatar || undefined,
      }

      setUser(userData)
      
      // Check if user is a team member (you may need to adjust this based on your schema)
      // For now, we'll set it to false, but you can add logic to check team membership
      setIsTeamMember(false)
    } catch (error) {
      console.error('Error fetching user data:', error)
      setUser(null)
    }
  }

  // Filter out subscription if user is a team member
  const navItems = isTeamMember 
    ? allNavItems.filter(item => item.href !== "/subscription")
    : allNavItems

  const handleLogout = () => {
    pb.authStore.clear()
    setUser(null)
    toast.success('Successfully logged out!')
    router.push('/login')
  }

  const getUserInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const getAvatarUrl = (avatar: string | undefined) => {
    if (!avatar) return undefined
    // If it's already a full URL, return as is
    if (avatar.startsWith('http')) return avatar
    // Otherwise, construct the URL
    return `${process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090'}/api/files/users/${user?.id}/${avatar}`
  }

  return (
    <TooltipProvider delayDuration={0}>
      <aside className="fixed left-0 top-0 z-50 hidden h-screen w-16 border-r border-sidebar-border bg-sidebar md:block">
        <div className="flex h-full flex-col items-center pt-3 pb-4">
          {/* Logo */}
          <Link
            href="/"
            className="mb-8 flex items-center justify-center"
          >
            <Image
              src={mounted && theme === 'dark' ? FaviconWhite : FaviconBlack}
              alt="Logo"
              width={100}
              height={100}
              className="h-10 w-10"
            />
          </Link>

          {/* Navigation */}
          <nav className="flex flex-1 flex-col gap-2">
            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                      )}
                    >
                      <item.icon className="h-5 w-5" />
                      <span className="sr-only">{item.label}</span>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent 
                    side="right"
                    className="bg-black text-white border border-gray-700"
                  >
                    <p>{item.label}</p>
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </nav>

          {/* User Avatar Dropdown */}
          {mounted && user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-sidebar-accent/50">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={getAvatarUrl(user.avatar)} alt={user.name} />
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs font-medium">
                      {getUserInitials(user.name)}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent 
                side="right" 
                align="start"
                className="w-64 bg-black text-white border border-gray-700"
              >
                <DropdownMenuLabel className="p-4">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={getAvatarUrl(user.avatar)} alt={user.name} />
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        {getUserInitials(user.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col">
                      <span className="font-medium text-sm">{user.name}</span>
                      <span className="text-xs text-muted-foreground">{user.email}</span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {!isTeamMember && (
                  <DropdownMenuItem 
                    onClick={() => router.push('/subscription')}
                    className="flex items-center gap-2 cursor-pointer hover:bg-gray-800"
                  >
                    <UserIcon className="h-4 w-4" />
                    <span className="text-sm">Subscription</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem 
                  onClick={() => router.push('/settings')}
                  className="flex items-center gap-2 cursor-pointer hover:bg-gray-800"
                >
                  <Settings className="h-4 w-4" />
                  <span className="text-sm">Settings</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  onClick={handleLogout}
                  className="flex items-center gap-2 cursor-pointer text-red-400 hover:text-red-300 hover:bg-gray-800"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="text-sm">Logout</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </aside>

      <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-around border-t border-sidebar-border bg-sidebar md:hidden">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg px-4 py-2 transition-colors",
                isActive ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/60",
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="text-xs">{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </TooltipProvider>
  )
}

