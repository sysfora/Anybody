"use client"

import { useState, useEffect, useRef } from "react"
import { Pencil, Trash2, Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import pb from "@/lib/pocketbase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

interface UserProfile {
    id: string
    name: string
    username: string
    email: string
    avatar?: string
    verified: boolean
    credits?: number
    credits_used?: number
    auto_reload_enabled?: boolean
    reload_amount?: number
    reload_threshold?: number
    plan?: string
    stripe_id?: string
}

export function SettingsForm() {
    const [user, setUser] = useState<UserProfile | null>(null)
    const [name, setName] = useState("")
    const [username, setUsername] = useState("")
    const [email, setEmail] = useState("")
    const [avatarFile, setAvatarFile] = useState<File | null>(null)
    const [avatarPreview, setAvatarPreview] = useState<string>("")
    const [newPassword, setNewPassword] = useState("")
    const [confirmPassword, setConfirmPassword] = useState("")
    const [loading, setLoading] = useState(false)
    const [profileLoading, setProfileLoading] = useState(true)
    const [passwordLoading, setPasswordLoading] = useState(false)
    const [deleteLoading, setDeleteLoading] = useState(false)
    const [deleteConfirmation, setDeleteConfirmation] = useState("")
    const [autoReloadEnabled, setAutoReloadEnabled] = useState(false)
    const [reloadAmount, setReloadAmount] = useState("10")
    const [reloadThreshold, setReloadThreshold] = useState("100")
    const [creditsLoading, setCreditsLoading] = useState(false)
    const [isPro, setIsPro] = useState(false)
    const [subscriptionLoading, setSubscriptionLoading] = useState(true)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const { toast } = useToast()
    const router = useRouter()

    useEffect(() => {
        fetchUserProfile()
        fetchSubscriptionStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const fetchUserProfile = async () => {
        try {
            const userId = pb.authStore.model?.id

            if (!userId) {
                toast({
                    title: "Error",
                    description: "Please log in to view your profile",
                    variant: "destructive",
                })
                router.push('/login')
                return
            }

            const response = await fetch('/api/user/get-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId }),
            })

            if (!response.ok) throw new Error('Failed to fetch profile')
            
            const data = await response.json()
            setUser(data)
            setName(data.name || '')
            setUsername(data.username || '')
            setEmail(data.email || '')
            setAutoReloadEnabled(data.auto_reload_enabled || false)
            setReloadAmount(String(data.reload_amount || 10))
            setReloadThreshold(String(data.reload_threshold || 100))
            
            if (data.avatar) {
                setAvatarPreview(`${process.env.NEXT_PUBLIC_POCKETBASE_URL}/api/files/users/${data.id}/${data.avatar}`)
            }
        } catch {
            toast({
                title: "Error",
                description: "Failed to load profile",
                variant: "destructive",
            })
        } finally {
            setProfileLoading(false)
        }
    }

    const fetchSubscriptionStatus = async () => {
        try {
            const userId = pb.authStore.model?.id

            if (!userId) {
                setSubscriptionLoading(false)
                return
            }

            const response = await fetch('/api/subscription/status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId }),
            })

            if (!response.ok) {
                setIsPro(false)
                setSubscriptionLoading(false)
                return
            }

            const data = await response.json()
            setIsPro(data.plan === 'pro' && data.hasActiveSubscription)
        } catch (error) {
            console.error('Error fetching subscription status:', error)
            setIsPro(false)
        } finally {
            setSubscriptionLoading(false)
        }
    }

    const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) {
            if (file.size > 2 * 1024 * 1024) {
                toast({
                    title: "Error",
                    description: "File size must be less than 2MB",
                    variant: "destructive",
                })
                return
            }

            setAvatarFile(file)
            const reader = new FileReader()
            reader.onloadend = () => {
                setAvatarPreview(reader.result as string)
            }
            reader.readAsDataURL(file)
        }
    }

    const handleProfileSave = async () => {
        setLoading(true)
        try {
            const userId = pb.authStore.model?.id

            if (!userId) {
                toast({
                    title: "Error",
                    description: "Please log in to update your profile",
                    variant: "destructive",
                })
                router.push('/login')
                return
            }

            const formData = new FormData()
            formData.append('userId', userId)
            formData.append('name', name)
            formData.append('username', username)
            if (avatarFile) {
                formData.append('avatar', avatarFile)
            }

            const response = await fetch('/api/user/update-profile', {
                method: 'POST',
                body: formData,
            })

            if (!response.ok) {
                const error = await response.json()
                throw new Error(error.error || 'Failed to update profile')
            }

            const data = await response.json()
            setUser(data.user)
            setAvatarFile(null)

            toast({
                title: "Success",
                description: "Your profile has been updated successfully",
            })
        } catch (error: unknown) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "Failed to update profile",
                variant: "destructive",
            })
        } finally {
            try 
            {
                await pb.collection('users').authRefresh();
            } catch {
            }
            
            setLoading(false)
        }
    }

    const handlePasswordUpdate = async () => {
        if (!newPassword || !confirmPassword) {
            toast({
                title: "Error",
                description: "All password fields are required",
                variant: "destructive",
            })
            return
        }

        if (newPassword !== confirmPassword) {
            toast({
                title: "Error",
                description: "Passwords do not match",
                variant: "destructive",
            })
            return
        }

        if (newPassword.length < 8) {
            toast({
                title: "Error",
                description: "Password must be at least 8 characters",
                variant: "destructive",
            })
            return
        }

        setPasswordLoading(true)
        try {
            const userId = pb.authStore.model?.id

            if (!userId) {
                toast({
                    title: "Error",
                    description: "Please log in to update your password",
                    variant: "destructive",
                })
                router.push('/login')
                return
            }

            const response = await fetch('/api/user/update-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId,
                    password: newPassword,
                    passwordConfirm: confirmPassword,
                }),
            })

            if (!response.ok) {
                const error = await response.json()
                throw new Error(error.error || 'Failed to update password')
            }

            setNewPassword('')
            setConfirmPassword('')

            toast({
                title: "Success",
                description: "Your password has been updated successfully",
            })
        } catch (error: unknown) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "Failed to update password",
                variant: "destructive",
            })
        } finally {
            setPasswordLoading(false)
        }
    }

    const handleDeleteAccount = async () => {
        setDeleteLoading(true)
        try {
            const userId = pb.authStore.model?.id

            if (!userId) {
                toast({
                    title: "Error",
                    description: "Please log in to delete your account",
                    variant: "destructive",
                })
                router.push('/login')
                return
            }

            const response = await fetch('/api/user/delete-account', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId }),
            })

            if (!response.ok) {
                const error = await response.json()
                throw new Error(error.error || 'Failed to delete account')
            }

            pb.authStore.clear()

            toast({
                title: "Account Deleted",
                description: "Your account has been permanently deleted",
            })

            setDeleteConfirmation("")

            setTimeout(() => {
                router.push('/login')
            }, 1000)
        } catch (error: unknown) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "Failed to delete account",
                variant: "destructive",
            })
            setDeleteLoading(false)
        }
    }

    const isDeleteConfirmed = deleteConfirmation === "DELETE MY ACCOUNT"

    const handleCreditsUpdate = async () => {
        setCreditsLoading(true)
        try {
            const userId = pb.authStore.model?.id

            if (!userId) {
                toast({
                    title: "Error",
                    description: "Please log in to update credits settings",
                    variant: "destructive",
                })
                router.push('/login')
                return
            }

            const amount = parseFloat(reloadAmount)
            const threshold = parseFloat(reloadThreshold)

            if (autoReloadEnabled && amount < 10) {
                toast({
                    title: "Error",
                    description: "Reload amount must be at least $10",
                    variant: "destructive",
                })
                setCreditsLoading(false)
                return
            }

            if (autoReloadEnabled && threshold < 100) {
                toast({
                    title: "Error",
                    description: "Reload threshold must be at least 100 credits",
                    variant: "destructive",
                })
                setCreditsLoading(false)
                return
            }

            const response = await fetch('/api/user/update-credits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId,
                    autoReloadEnabled,
                    reloadAmount: amount,
                    reloadThreshold: threshold,
                }),
            })

            if (!response.ok) {
                const error = await response.json()
                throw new Error(error.error || 'Failed to update credits settings')
            }

            const data = await response.json()
            setUser(data.user)

            toast({
                title: "Success",
                description: "Credits settings updated successfully",
            })
        } catch (error: unknown) {
        toast({
                title: "Error",
                description: error instanceof Error ? error.message : "Failed to update credits settings",
                variant: "destructive",
            })
        } finally {
            setCreditsLoading(false)
        }
    }

    const getInitials = (name: string) => {
        return name
            .split(' ')
            .map(part => part[0])
            .join('')
            .toUpperCase()
            .slice(0, 2)
    }

    if (profileLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Profile Settings */}
            <Card>
                <CardHeader>
                    <CardTitle>Profile</CardTitle>
                    <CardDescription>Update your profile information</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Profile Picture */}
                    <div className="flex items-center gap-4">
                        <div className="relative">
                            {avatarPreview ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={avatarPreview}
                                    alt="Profile"
                                    className="h-20 w-20 rounded-full object-cover border-2 border-border"
                                />
                            ) : (
                                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-2xl border-2 border-border">
                                    {user?.name ? getInitials(user.name) : 'U'}
                            </div>
                            )}
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleAvatarChange}
                            />
                            <Button
                                size="sm"
                                variant="outline"
                                className="absolute bottom-0 right-0 h-8 w-8 rounded-full p-0 z-10 border-2 border-background bg-secondary shadow-sm hover:bg-secondary/80"
                                onClick={() => fileInputRef.current?.click()}
                                title="Edit profile picture"
                            >
                                <Pencil className="h-4 w-4 text-foreground" />
                            </Button>
                        </div>
                        <div>
                            <p className="font-medium">Profile Picture</p>
                            <p className="text-muted-foreground text-sm">JPG, PNG or GIF. Max 2MB</p>
                        </div>
                    </div>

                    {/* Name */}
                    <div className="space-y-2">
                        <Label htmlFor="name">Name</Label>
                        <Input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            disabled={loading}
                        />
                    </div>

                    {/* Username */}
                    <div className="space-y-2">
                        <Label htmlFor="username">Username</Label>
                        <Input
                            id="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            disabled={loading}
                        />
                    </div>

                    {/* Email */}
                    <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                            id="email"
                            type="email"
                            value={email}
                            disabled
                            className="bg-muted cursor-not-allowed"
                        />
                    </div>

                    <Button onClick={handleProfileSave} disabled={loading}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save Changes
                    </Button>
                </CardContent>
            </Card>

            {/* Password */}
            <Card>
                <CardHeader>
                    <CardTitle>Password</CardTitle>
                    <CardDescription>Change your password</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="new-password">New Password</Label>
                        <Input
                            id="new-password"
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            disabled={passwordLoading}
                            placeholder="Enter new password"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="confirm-password">Confirm New Password</Label>
                        <Input
                            id="confirm-password"
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            disabled={passwordLoading}
                            placeholder="Confirm new password"
                        />
                    </div>
                    <Button onClick={handlePasswordUpdate} disabled={passwordLoading}>
                        {passwordLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Update Password
                    </Button>
                </CardContent>
            </Card>

            {/* Usage */}
            <Card>
                <CardHeader>
                    <CardTitle>Usage</CardTitle>
                    <CardDescription>Your current usage and credits</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Credits</span>
                            <span className="font-medium">{user?.credits_used || 0}/{user?.credits || 0} credits</span>
                        </div>
                        <Progress value={user?.credits_used ? Math.min((user.credits_used / (user.credits || 0)) * 100, 100) : 0} />
                    </div>
                    
                    <div className="space-y-4 pt-4 border-t">
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label htmlFor="auto-reload" className="text-base">Enable Auto Reload</Label>
                                <p className="text-sm text-muted-foreground">
                                    {subscriptionLoading 
                                        ? "Checking subscription status..."
                                        : !isPro
                                        ? "Auto-reload is only available for Pro users" 
                                        : "Automatically reload credits when they reach the threshold"}
                                </p>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Switch
                                    id="auto-reload"
                                    checked={autoReloadEnabled}
                                    onCheckedChange={(checked) => {
                                        if (checked && !isPro) {
                                            toast({
                                                title: "Pro Feature",
                                                description: "Auto-reload is only available for Pro users. Please upgrade to Pro to use this feature.",
                                                variant: "destructive",
                                            })
                                            return;
                                        }
                                        setAutoReloadEnabled(checked);
                                    }}
                                    disabled={creditsLoading || subscriptionLoading || !isPro}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="reload-amount">Amount To Reload ($)</Label>
                            <Input
                                id="reload-amount"
                                type="number"
                                min="10"
                                step="1"
                                value={reloadAmount}
                                onChange={(e) => setReloadAmount(e.target.value)}
                                disabled={creditsLoading || !autoReloadEnabled}
                                placeholder="Minimum $10"
                            />
                            <p className="text-xs text-muted-foreground">Minimum: $10</p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="reload-threshold">When Credits Reach</Label>
                            <Input
                                id="reload-threshold"
                                type="number"
                                min="100"
                                step="1"
                                value={reloadThreshold}
                                onChange={(e) => setReloadThreshold(e.target.value)}
                                disabled={creditsLoading || !autoReloadEnabled}
                                placeholder="Minimum 100 credits"
                            />
                            <p className="text-xs text-muted-foreground">Minimum: 100 credits</p>
                        </div>

                        <Button onClick={handleCreditsUpdate} disabled={creditsLoading}>
                            {creditsLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save Credits Settings
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Delete Account */}
            <Card className="border-red-500 border">
                <CardHeader>
                    <CardTitle className="text-destructive">Danger Zone</CardTitle>
                    <CardDescription>Permanently delete your account and all data</CardDescription>
                </CardHeader>
                <CardContent>
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="destructive" disabled={deleteLoading}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete Account
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This action cannot be undone. This will permanently delete your account and remove all your data from
                                    our servers.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <div className="py-4">
                                <Label htmlFor="delete-confirmation" className="text-sm">
                                    Type <span className="font-semibold">DELETE MY ACCOUNT</span> to confirm
                                </Label>
                                <Input
                                    id="delete-confirmation"
                                    value={deleteConfirmation}
                                    onChange={(e) => setDeleteConfirmation(e.target.value)}
                                    placeholder="DELETE MY ACCOUNT"
                                    disabled={deleteLoading}
                                    className="mt-2"
                                />
                            </div>
                            <AlertDialogFooter>
                                <AlertDialogCancel 
                                    disabled={deleteLoading}
                                    onClick={() => setDeleteConfirmation("")}
                                >
                                    Cancel
                                </AlertDialogCancel>
                                <AlertDialogAction
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    onClick={handleDeleteAccount}
                                    disabled={deleteLoading || !isDeleteConfirmed}
                                >
                                    {deleteLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Delete Account
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </CardContent>
            </Card>
        </div>
    )
}
