"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Mail, Trash2, UserPlus, Clock, Send, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/hooks/use-toast"
import { TeamService } from "@/lib/team"
import { TeamMember, TeamInvitation, Team } from "@/lib/types"
import pb from "@/lib/pocketbase"
import { SubscriptionPopup } from "@/components/SubscriptionPopup"

export function TeamManagement() {
    const [team, setTeam] = useState<Team | null>(null)
    const [members, setMembers] = useState<TeamMember[]>([])
    const [invitations, setInvitations] = useState<TeamInvitation[]>([])
    const [email, setEmail] = useState("")
    const [loading, setLoading] = useState(true)
    const [inviting, setInviting] = useState(false)
    const [resendingId, setResendingId] = useState<string | null>(null)
    const [cancellingId, setCancellingId] = useState<string | null>(null)
    const [removingId, setRemovingId] = useState<string | null>(null)
    const [isOwner, setIsOwner] = useState(false)
    const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null)
    const [showRemoveDialog, setShowRemoveDialog] = useState(false)
    const [isCreatingTeam, setIsCreatingTeam] = useState(false)
    const [showSubscriptionPopup, setShowSubscriptionPopup] = useState(false)
    const [isProUser, setIsProUser] = useState(false)
    const { toast } = useToast()

    const getUserInitials = (name: string) => {
        return name
            .split(' ')
            .map(word => word.charAt(0))
            .join('')
            .toUpperCase()
            .slice(0, 2)
    }

    const getAvatarUrl = (avatar: string | undefined, userId: string) => {
        if (!avatar) return undefined
        if (avatar.startsWith('http')) return avatar
        return `${process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090'}/api/files/users/${userId}/${avatar}`
    }

    const isEmailAlreadyInvitedOrMember = (emailToCheck: string): boolean => {
        const normalizedEmail = emailToCheck.toLowerCase().trim()
        
        // Check if email is already a team member
        const isMember = members.some(
            member => member.expand?.user?.email.toLowerCase() === normalizedEmail
        )
        
        // Check if email has pending invitation
        const hasPendingInvitation = invitations.some(
            invitation => invitation.email.toLowerCase() === normalizedEmail
        )
        
        return isMember || hasPendingInvitation
    }

    useEffect(() => {
        loadTeamData()
        checkSubscriptionStatus()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const checkSubscriptionStatus = async () => {
        try {
            const user = pb.authStore.model
            if (!user) return

            // Check subscription status - this will use effective user ID (owner's ID) for team members
            const response = await fetch('/api/subscription/status', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ userId: user.id }),
            })

            if (response.ok) {
                const data = await response.json()
                setIsProUser(data.hasActiveSubscription && data.plan === 'pro')
            } else {
                // If user is team member, they can't access subscription status
                // In that case, we'll assume they're not Pro
                if (response.status === 403) {
                    setIsProUser(false)
                } else {
                    // For other errors, assume not Pro
                    setIsProUser(false)
                }
            }
        } catch (error) {
            console.error('Error checking subscription status:', error)
            setIsProUser(false)
        }
    }

    const loadTeamData = async () => {
        try {
            const teamData = await TeamService.getUserTeam()
            if (teamData) {
                setTeam(teamData.team)
                setMembers(teamData.members)
                
                // Check if current user is the owner
                const currentUser = pb.authStore.model
                if (currentUser) {
                    const currentMember = teamData.members.find(m => m.user === currentUser.id)
                    setIsOwner(currentMember?.role === 'owner')
                }
                
                await loadInvitations(teamData.team.id)
            } else {
                await createDefaultTeam()
            }
        } catch (error) {
            console.error("Failed to load team data:", error)
            toast({
                title: "Error",
                description: "Failed to load team data",
                variant: "destructive",
            })
        } finally {
            setLoading(false)
        }
    }

    const createDefaultTeam = async () => {
        if (isCreatingTeam) return // Prevent duplicate calls
        
        setIsCreatingTeam(true)
        try {
            const user = pb.authStore.model
            if (!user) {
                setLoading(false)
                return
            }

            await TeamService.createTeam(`${user.name || user.email}'s Team`)
            
            // Fetch the updated team data
            const teamData = await TeamService.getUserTeam()
            if (teamData) {
                setTeam(teamData.team)
                setMembers(teamData.members)
                
                const currentMember = teamData.members.find(m => m.user === user.id)
                setIsOwner(currentMember?.role === 'owner')
                
                await loadInvitations(teamData.team.id)
            }
        } catch (error) {
            console.error("Failed to create team:", error)
            toast({
                title: "Error",
                description: "Failed to create default team",
                variant: "destructive",
            })
        } finally {
            setIsCreatingTeam(false)
            setLoading(false)
        }
    }

    const loadInvitations = async (teamId: string) => {
        try {
            const invites = await TeamService.getTeamInvitations(teamId)
            setInvitations(invites)
        } catch (error) {
            console.error("Failed to load invitations:", error)
        }
    }

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!email || !team) return

        // Check if user has Pro subscription
        if (!isProUser) {
            setShowSubscriptionPopup(true)
            return
        }

        // Check if email is already invited or a member
        if (isEmailAlreadyInvitedOrMember(email)) {
            toast({
                title: "Already invited or member",
                description: "This email address is already a team member or has a pending invitation",
                variant: "destructive",
            })
            return
        }

        setInviting(true)
        try {
            await TeamService.inviteTeamMember(team.id, email)
            await loadInvitations(team.id)
            setEmail("")
            toast({
                title: "Invitation sent",
                description: `An invitation has been sent to ${email}`,
            })
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "Failed to send invitation",
                variant: "destructive",
            })
        } finally {
            setInviting(false)
        }
    }

    const handleResendInvitation = async (invitationId: string, invitationEmail: string) => {
        if (!team) return

        // Check if user has Pro subscription
        if (!isProUser) {
            setShowSubscriptionPopup(true)
            return
        }

        setResendingId(invitationId)
        try {
            // Cancel the old invitation
            await TeamService.cancelInvitation(invitationId)
            // Send a new invitation
            await TeamService.inviteTeamMember(team.id, invitationEmail)
            // Reload invitations
            await loadInvitations(team.id)
            toast({
                title: "Invitation resent",
                description: `A new invitation has been sent to ${invitationEmail}`,
            })
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "Failed to resend invitation",
                variant: "destructive",
            })
        } finally {
            setResendingId(null)
        }
    }

    const confirmRemoveMember = async () => {
        if (!memberToRemove) return

        setRemovingId(memberToRemove.id)
        setShowRemoveDialog(false)
        
        try {
            await TeamService.removeMember(memberToRemove.id)
            setMembers(members.filter((m) => m.id !== memberToRemove.id))
            toast({
                title: "Member removed",
                description: "Team member has been removed",
            })
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "Failed to remove member",
                variant: "destructive",
            })
        } finally {
            setRemovingId(null)
            setMemberToRemove(null)
        }
    }

    const handleCancelInvitation = async (invitationId: string) => {
        setCancellingId(invitationId)
        try {
            await TeamService.cancelInvitation(invitationId)
            setInvitations(invitations.filter((i) => i.id !== invitationId))
            toast({
                title: "Invitation cancelled",
                description: "The invitation has been cancelled",
            })
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "Failed to cancel invitation",
                variant: "destructive",
            })
        } finally {
            setCancellingId(null)
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Loading team data...</span>
                </div>
            </div>
        )
    }

    return (
        <TooltipProvider>
            <div className="space-y-6">
                {/* Invite Form - Only visible to owner */}
                {isOwner && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Invite Team Member</CardTitle>
                            <CardDescription>Send an invitation to join your team</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleInvite} className="flex gap-4">
                                <div className="flex-1">
                                    <Label htmlFor="email" className="sr-only">
                                        Email
                                    </Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        placeholder="colleague@example.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        disabled={inviting}
                                    />
                                </div>
                                <Button type="submit" disabled={inviting}>
                                    {inviting ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Sending...
                                        </>
                                    ) : (
                                        <>
                                            <UserPlus className="mr-2 h-4 w-4" />
                                            Invite
                                        </>
                                    )}
                                </Button>
                            </form>
                        </CardContent>
                    </Card>
                )}

                {/* Pending Invitations - Only visible to owner */}
                {isOwner && invitations.length > 0 && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Pending Invitations</CardTitle>
                            <CardDescription>Invitations waiting to be accepted</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {invitations.map((invitation) => (
                                    <div key={invitation.id} className="flex items-center justify-between rounded-lg border border-border p-4">
                                        <div className="flex items-center gap-4">
                                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                                                <Clock className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <p className="font-medium">{invitation.email}</p>
                                                <p className="text-muted-foreground text-sm">
                                                    Invited by {invitation.expand?.invited_by?.name || invitation.expand?.invited_by?.email}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button 
                                                        variant="ghost" 
                                                        size="sm" 
                                                        onClick={() => handleResendInvitation(invitation.id, invitation.email)}
                                                        disabled={resendingId === invitation.id || cancellingId === invitation.id}
                                                    >
                                                        {resendingId === invitation.id ? (
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                        ) : (
                                                            <Send className="h-4 w-4" />
                                                        )}
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent 
                                                    className="bg-black text-white border border-gray-700"
                                                    sideOffset={5}
                                                >
                                                    <p>Resend invitation</p>
                                                </TooltipContent>
                                            </Tooltip>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button 
                                                        variant="ghost" 
                                                        size="sm" 
                                                        onClick={() => handleCancelInvitation(invitation.id)}
                                                        disabled={resendingId === invitation.id || cancellingId === invitation.id}
                                                    >
                                                        {cancellingId === invitation.id ? (
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                        ) : (
                                                            <Trash2 className="h-4 w-4" />
                                                        )}
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent 
                                                    className="bg-black text-white border border-gray-700"
                                                    sideOffset={5}
                                                >
                                                    <p>Cancel invitation</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                )}

            {/* Team Members List */}
            <Card>
                <CardHeader>
                    <CardTitle>Team Members</CardTitle>
                    <CardDescription>
                        {isOwner 
                            ? "Manage your team members and their access" 
                            : "View your team members"}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {members.length === 0 ? (
                            <div className="text-center text-muted-foreground py-8">
                                No team members yet
                            </div>
                        ) : (
                            members.map((member) => (
                                <div key={member.id} className="flex items-center justify-between rounded-lg border border-border p-4">
                                    <div className="flex items-center gap-4">
                                        <Avatar className="h-10 w-10">
                                            <AvatarImage 
                                                src={getAvatarUrl(member.expand?.user?.avatar, member.expand?.user?.id || '')} 
                                                alt={member.expand?.user?.name || member.expand?.user?.email} 
                                            />
                                            <AvatarFallback className="bg-primary text-primary-foreground">
                                                {member.expand?.user?.name 
                                                    ? getUserInitials(member.expand.user.name)
                                                    : <Mail className="h-5 w-5" />
                                                }
                                            </AvatarFallback>
                                        </Avatar>
                                        <div>
                                            <p className="font-medium">
                                                {member.expand?.user?.name || member.expand?.user?.email}
                                            </p>
                                            <div className="flex items-center gap-2">
                                                <p className="text-muted-foreground text-sm">
                                                    {member.expand?.user?.email}
                                                </p>
                                                {member.role === "owner" && (
                                                    <Badge variant="outline" className="text-xs">
                                                        Owner
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    {isOwner && member.role !== "owner" && (
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button 
                                                    variant="ghost" 
                                                    size="sm" 
                                                    onClick={() => {
                                                        setMemberToRemove(member)
                                                        setShowRemoveDialog(true)
                                                    }}
                                                    disabled={removingId === member.id}
                                                >
                                                    {removingId === member.id ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <Trash2 className="h-4 w-4" />
                                                    )}
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent 
                                                className="bg-black text-white border border-gray-700"
                                                sideOffset={5}
                                            >
                                                <p>Remove member</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Confirmation Dialog for Removing Members */}
            <AlertDialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove Team Member</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to remove{" "}
                            <span className="font-semibold">
                                {memberToRemove?.expand?.user?.name || memberToRemove?.expand?.user?.email}
                            </span>{" "}
                            from the team? This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setMemberToRemove(null)}>
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmRemoveMember}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Remove
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Subscription Popup */}
            <SubscriptionPopup
                open={showSubscriptionPopup}
                onOpenChange={setShowSubscriptionPopup}
            />
            </div>
        </TooltipProvider>
    )
}
