"use client"

import { useState, useEffect, useRef } from "react"
import { Pencil, Trash2, Loader2, Eye, EyeOff } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import pb from "@/lib/pocketbase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
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

export function SettingsForm({ scrollTo }: { scrollTo?: string }) {
    const [user, setUser] = useState<UserProfile | null>(null)

    // Profile fields
    const [name, setName] = useState("")
    const [username, setUsername] = useState("")
    const [avatarFile, setAvatarFile] = useState<File | null>(null)
    const [avatarPreview, setAvatarPreview] = useState<string>("")

    // Saved originals — used to detect unsaved changes
    const [savedName, setSavedName] = useState("")
    const [savedUsername, setSavedUsername] = useState("")

    // Password fields
    const [newPassword, setNewPassword] = useState("")
    const [confirmPassword, setConfirmPassword] = useState("")
    const [showNew, setShowNew] = useState(false)
    const [showConfirm, setShowConfirm] = useState(false)

    // Credits / auto-reload
    const [autoReloadEnabled, setAutoReloadEnabled] = useState(false)
    const [reloadAmount, setReloadAmount] = useState("10")
    const [reloadThreshold, setReloadThreshold] = useState("100")
    const [isPro, setIsPro] = useState(false)

    // Delete account
    const [deleteConfirmation, setDeleteConfirmation] = useState("")
    const [deleteOpen, setDeleteOpen] = useState(false)

    // Loading states
    const [profileLoading, setProfileLoading] = useState(true)
    const [saveLoading, setSaveLoading] = useState(false)
    const [passwordLoading, setPasswordLoading] = useState(false)
    const [creditsLoading, setCreditsLoading] = useState(false)
    const [subscriptionLoading, setSubscriptionLoading] = useState(true)
    const [deleteLoading, setDeleteLoading] = useState(false)

    const fileInputRef = useRef<HTMLInputElement>(null)
    const usageSectionRef = useRef<HTMLDivElement>(null)
    const router = useRouter()

    useEffect(() => {
        fetchUserProfile()
        fetchSubscriptionStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Scroll to the requested section once the profile has loaded
    useEffect(() => {
        if (!scrollTo || profileLoading) return
        const sectionMap: Record<string, React.RefObject<HTMLDivElement | null>> = {
            credits: usageSectionRef,
            usage: usageSectionRef,
        }
        const ref = sectionMap[scrollTo.toLowerCase()]
        if (!ref?.current) return
        // Slight delay so the scroll container has finished its layout
        setTimeout(() => {
            ref.current?.scrollIntoView({ behavior: "smooth", block: "start" })
        }, 120)
    }, [scrollTo, profileLoading])

    // ── helpers ────────────────────────────────────────────────────────────────

    const getUserId = () => {
        const id = pb.authStore.record?.id
        if (!id) {
            toast.error("Session expired. Please log in again.")
            router.push("/login")
        }
        return id
    }

    const getInitials = (n: string) =>
        n.split(" ").map(p => p[0]).join("").toUpperCase().slice(0, 2)

    const availableCredits = (user?.credits ?? 0) - (user?.credits_used ?? 0)
    const creditsPercent = user?.credits
        ? Math.min((( user.credits_used ?? 0) / user.credits) * 100, 100)
        : 0

    const hasProfileChanges =
        name !== savedName || username !== savedUsername || avatarFile !== null

    // ── data fetching ──────────────────────────────────────────────────────────

    const fetchUserProfile = async () => {
        const userId = pb.authStore.record?.id
        if (!userId) { setProfileLoading(false); return }

        try {
            const res = await fetch("/api/user/get-profile", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId }),
            })
            if (!res.ok) throw new Error("Failed to fetch profile")
            const data: UserProfile = await res.json()

            setUser(data)
            setName(data.name ?? "")
            setUsername(data.username ?? "")
            setSavedName(data.name ?? "")
            setSavedUsername(data.username ?? "")
            setAutoReloadEnabled(data.auto_reload_enabled ?? false)
            setReloadAmount(String(data.reload_amount ?? 10))
            setReloadThreshold(String(data.reload_threshold ?? 100))

            if (data.avatar) {
                setAvatarPreview(
                    `${process.env.NEXT_PUBLIC_POCKETBASE_URL}/api/files/users/${data.id}/${data.avatar}`
                )
            }
        } catch {
            toast.error("Failed to load profile. Please refresh.")
        } finally {
            setProfileLoading(false)
        }
    }

    const fetchSubscriptionStatus = async () => {
        const userId = pb.authStore.record?.id
        if (!userId) { setSubscriptionLoading(false); return }

        try {
            const res = await fetch("/api/subscription/status", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId }),
            })
            if (res.ok) {
                const data = await res.json()
                setIsPro(data.plan === "pro" && data.hasActiveSubscription)
            }
        } catch {
            setIsPro(false)
        } finally {
            setSubscriptionLoading(false)
        }
    }

    // ── handlers ───────────────────────────────────────────────────────────────

    const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        if (file.size > 2 * 1024 * 1024) {
            toast.error("Image must be smaller than 2 MB.")
            return
        }
        setAvatarFile(file)
        const reader = new FileReader()
        reader.onloadend = () => setAvatarPreview(reader.result as string)
        reader.readAsDataURL(file)
    }

    const handleProfileSave = async () => {
        const userId = getUserId()
        if (!userId) return
        if (!hasProfileChanges) {
            toast.info("No changes to save.")
            return
        }

        setSaveLoading(true)
        try {
            const formData = new FormData()
            formData.append("userId", userId)
            formData.append("name", name)
            formData.append("username", username)
            if (avatarFile) formData.append("avatar", avatarFile)

            const res = await fetch("/api/user/update-profile", {
                method: "POST",
                body: formData,
            })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error ?? "Failed to update profile")
            }

            const data = await res.json()
            setUser(prev => prev ? { ...prev, ...data.user } : prev)
            setSavedName(data.user.name ?? name)
            setSavedUsername(data.user.username ?? username)
            setAvatarFile(null)

            try { await pb.collection("users").authRefresh() } catch { /* ignore */ }
            toast.success("Profile updated successfully.")
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to update profile.")
        } finally {
            setSaveLoading(false)
        }
    }

    const handlePasswordUpdate = async () => {
        if (!newPassword || !confirmPassword) {
            toast.error("Both password fields are required.")
            return
        }
        if (newPassword !== confirmPassword) {
            toast.error("Passwords do not match.")
            return
        }
        if (newPassword.length < 8) {
            toast.error("Password must be at least 8 characters.")
            return
        }

        const userId = getUserId()
        if (!userId) return

        setPasswordLoading(true)
        try {
            const res = await fetch("/api/user/update-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId, password: newPassword, passwordConfirm: confirmPassword }),
            })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error ?? "Failed to update password")
            }
            setNewPassword("")
            setConfirmPassword("")
            toast.success("Password changed successfully.")
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to update password.")
        } finally {
            setPasswordLoading(false)
        }
    }

    const handleCreditsUpdate = async () => {
        const userId = getUserId()
        if (!userId) return

        const amount = parseFloat(reloadAmount)
        const threshold = parseFloat(reloadThreshold)

        if (autoReloadEnabled && amount < 10) {
            toast.error("Reload amount must be at least $10.")
            return
        }
        if (autoReloadEnabled && threshold < 100) {
            toast.error("Reload threshold must be at least 100 credits.")
            return
        }

        setCreditsLoading(true)
        try {
            const res = await fetch("/api/user/update-credits", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId, autoReloadEnabled, reloadAmount: amount, reloadThreshold: threshold }),
            })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error ?? "Failed to update credits settings")
            }
            const data = await res.json()
            setUser(data.user)
            toast.success("Credits settings saved.")
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to update credits settings.")
        } finally {
            setCreditsLoading(false)
        }
    }

    const handleDeleteAccount = async () => {
        const userId = getUserId()
        if (!userId) return

        setDeleteLoading(true)
        try {
            const res = await fetch("/api/user/delete-account", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId }),
            })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error ?? "Failed to delete account")
            }
            pb.authStore.clear()
            toast.success("Account permanently deleted.")
            setDeleteOpen(false)
            router.push("/login")
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to delete account.")
            setDeleteLoading(false)
        }
    }

    // ── render ─────────────────────────────────────────────────────────────────

    if (profileLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="space-y-6">

            {/* ── Profile ── */}
            <Card>
                <CardHeader>
                    <CardTitle>Profile</CardTitle>
                    <CardDescription>Update your display name, username, and avatar.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Avatar */}
                    <div className="flex items-center gap-4">
                        <div className="relative shrink-0">
                            {avatarPreview ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={avatarPreview}
                                    alt="Avatar"
                                    className="h-20 w-20 rounded-full object-cover border border-border"
                                />
                            ) : (
                                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-primary-foreground text-2xl font-bold border border-border">
                                    {user?.name ? getInitials(user.name) : "U"}
                                </div>
                            )}
                            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
                            <Button
                                size="sm"
                                variant="outline"
                                className="absolute bottom-0 right-0 h-7 w-7 rounded-full p-0 border border-border bg-background"
                                onClick={() => fileInputRef.current?.click()}
                                title="Change avatar"
                            >
                                <Pencil className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                        <div>
                            <p className="font-medium text-sm">Profile Picture</p>
                            <p className="text-xs text-muted-foreground mt-0.5">JPG, PNG or GIF · max 2 MB</p>
                            {avatarFile && (
                                <p className="text-xs text-primary mt-1">{avatarFile.name} selected</p>
                            )}
                        </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="name">Display Name</Label>
                            <Input id="name" value={name} onChange={e => setName(e.target.value)} disabled={saveLoading} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="username">Username</Label>
                            <Input id="username" value={username} onChange={e => setUsername(e.target.value)} disabled={saveLoading} />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" type="email" value={user?.email ?? ""} disabled className="bg-muted cursor-not-allowed" />
                        <p className="text-xs text-muted-foreground">Email cannot be changed.</p>
                    </div>

                    <Button onClick={handleProfileSave} disabled={saveLoading || !hasProfileChanges}>
                        {saveLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save Changes
                    </Button>
                </CardContent>
            </Card>

            {/* ── Password ── */}
            <Card>
                <CardHeader>
                    <CardTitle>Password</CardTitle>
                    <CardDescription>Set a new password for your account.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="new-password">New Password</Label>
                        <div className="relative">
                            <Input
                                id="new-password"
                                type={showNew ? "text" : "password"}
                                value={newPassword}
                                onChange={e => setNewPassword(e.target.value)}
                                disabled={passwordLoading}
                                placeholder="Min. 8 characters"
                                className="pr-10"
                            />
                            <button
                                type="button"
                                onClick={() => setShowNew(v => !v)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                tabIndex={-1}
                            >
                                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="confirm-password">Confirm New Password</Label>
                        <div className="relative">
                            <Input
                                id="confirm-password"
                                type={showConfirm ? "text" : "password"}
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                                disabled={passwordLoading}
                                placeholder="Repeat your new password"
                                className="pr-10"
                            />
                            <button
                                type="button"
                                onClick={() => setShowConfirm(v => !v)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                tabIndex={-1}
                            >
                                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                        </div>
                        {confirmPassword && newPassword !== confirmPassword && (
                            <p className="text-xs text-destructive">Passwords do not match.</p>
                        )}
                    </div>

                    <Button
                        onClick={handlePasswordUpdate}
                        disabled={passwordLoading || !newPassword || !confirmPassword}
                    >
                        {passwordLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Update Password
                    </Button>
                </CardContent>
            </Card>

            {/* ── Usage ── */}
            <Card ref={usageSectionRef}>
                <CardHeader>
                    <CardTitle>Usage</CardTitle>
                    <CardDescription>Your credit balance and auto-reload settings.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Credit bar */}
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Credits used</span>
                            <span className="font-medium tabular-nums">
                                {user?.credits_used ?? 0} / {user?.credits ?? 0}
                            </span>
                        </div>
                        <Progress value={creditsPercent} className="h-2" />
                        <p className="text-xs text-muted-foreground">
                            {availableCredits} credit{availableCredits !== 1 ? "s" : ""} remaining
                        </p>
                    </div>

                    {/* Auto-reload */}
                    <div className="space-y-4 pt-4 border-t">
                        <div className="flex items-start justify-between gap-4">
                            <div className="space-y-0.5">
                                <Label htmlFor="auto-reload" className="text-sm font-medium">Auto-Reload</Label>
                                <p className="text-xs text-muted-foreground">
                                    {subscriptionLoading
                                        ? "Checking plan…"
                                        : !isPro
                                        ? "Available on Pro plan only."
                                        : "Top up automatically when credits fall below the threshold."}
                                </p>
                            </div>
                            <Switch
                                id="auto-reload"
                                checked={autoReloadEnabled}
                                onCheckedChange={checked => {
                                    if (checked && !isPro) {
                                        toast.error("Auto-reload is only available for Pro users.")
                                        return
                                    }
                                    setAutoReloadEnabled(checked)
                                }}
                                disabled={creditsLoading || subscriptionLoading || !isPro}
                            />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="reload-amount">Reload Amount ($)</Label>
                                <Input
                                    id="reload-amount"
                                    type="number"
                                    min="10"
                                    step="1"
                                    value={reloadAmount}
                                    onChange={e => setReloadAmount(e.target.value)}
                                    disabled={creditsLoading || !autoReloadEnabled}
                                    placeholder="Min. $10"
                                />
                                <p className="text-xs text-muted-foreground">Minimum $10</p>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="reload-threshold">Reload When Below</Label>
                                <Input
                                    id="reload-threshold"
                                    type="number"
                                    min="100"
                                    step="1"
                                    value={reloadThreshold}
                                    onChange={e => setReloadThreshold(e.target.value)}
                                    disabled={creditsLoading || !autoReloadEnabled}
                                    placeholder="Min. 100 credits"
                                />
                                <p className="text-xs text-muted-foreground">Minimum 100 credits</p>
                            </div>
                        </div>

                        <Button onClick={handleCreditsUpdate} disabled={creditsLoading}>
                            {creditsLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save Credits Settings
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* ── Danger Zone ── */}
            <Card className="border-destructive/40">
                <CardHeader>
                    <CardTitle className="text-destructive">Danger Zone</CardTitle>
                    <CardDescription>Permanently delete your account and all associated data.</CardDescription>
                </CardHeader>
                <CardContent>
                    <AlertDialog open={deleteOpen} onOpenChange={open => {
                        setDeleteOpen(open)
                        if (!open) setDeleteConfirmation("")
                    }}>
                        <AlertDialogTrigger asChild>
                            <Button variant="destructive" disabled={deleteLoading}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete Account
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This is irreversible. All your projects, credits, and subscription data will be permanently removed.
                                </AlertDialogDescription>
                            </AlertDialogHeader>

                            <div className="py-2 space-y-2">
                                <Label htmlFor="delete-confirmation" className="text-sm">
                                    Type <span className="font-semibold select-none">DELETE MY ACCOUNT</span> to confirm
                                </Label>
                                <Input
                                    id="delete-confirmation"
                                    value={deleteConfirmation}
                                    onChange={e => setDeleteConfirmation(e.target.value)}
                                    placeholder="DELETE MY ACCOUNT"
                                    disabled={deleteLoading}
                                    autoComplete="off"
                                />
                            </div>

                            <AlertDialogFooter>
                                <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    onClick={e => {
                                        e.preventDefault()
                                        void handleDeleteAccount()
                                    }}
                                    disabled={deleteLoading || deleteConfirmation !== "DELETE MY ACCOUNT"}
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
