"use client"

import { useEffect, useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { TeamService } from "@/lib/team"
import { TeamInvitation } from "@/lib/types"
import pb from "@/lib/pocketbase"
import { Loader2, UserPlus, AlertCircle } from "lucide-react"
import Link from "next/link"

function AcceptInvitationContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get("token")
  const [invitation, setInvitation] = useState<TeamInvitation | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (token) {
      loadInvitation()
    } else {
      setError("Invalid invitation link")
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const loadInvitation = async () => {
    if (!token) return

    try {
      const inv = await TeamService.getInvitationByTokenAsAdmin(token)
      if (!inv) {
        setError("This invitation has expired or is no longer valid")
      } else {
        setInvitation(inv)
        if (pb.authStore.isValid) {
          await handleAccept()
        }
      }
    } catch {
      setError("Failed to load invitation")
    } finally {
      setLoading(false)
    }
  }

  const handleAccept = async () => {
    if (!token) return

    if (!pb.authStore.isValid) {
      TeamService.storePendingInvitation(token)
      router.push("/login?redirect=invite")
      return
    }

    setProcessing(true)
    try {
      await TeamService.acceptInvitation(token)
      setSuccess(true)
      setTimeout(() => {
        router.push("/team")
      }, 2000)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to accept invitation"
      if (errorMessage === "User must be authenticated") {
        TeamService.storePendingInvitation(token)
        router.push("/login?redirect=invite")
      } else {
        setError(errorMessage)
      }
    } finally {
      setProcessing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-green-600" />
              Invitation Accepted
            </CardTitle>
            <CardDescription>You have successfully joined the team!</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">Redirecting to team page...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-600" />
              Error
            </CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/">
              <Button className="w-full">Go to Home</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Team Invitation</CardTitle>
          <CardDescription>You have been invited to join a team</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {invitation && (
            <div className="rounded-lg border border-border p-4">
              <p className="mb-2 text-sm text-muted-foreground">Team</p>
              <p className="mb-4 font-semibold">{invitation.expand?.team?.name}</p>
              <p className="mb-2 text-sm text-muted-foreground">Invited by</p>
              <p className="font-medium">
                {invitation.expand?.invited_by?.name || invitation.expand?.invited_by?.email}
              </p>
            </div>
          )}

          {!pb.authStore.isValid ? (
            <div className="space-y-4">
              <p className="text-muted-foreground text-sm">You need to log in or create an account to accept this invitation.</p>
              <div className="flex gap-4">
                <Link href="/login" className="flex-1">
                  <Button className="w-full" onClick={() => TeamService.storePendingInvitation(token!)}>
                    Log In
                  </Button>
                </Link>
                <Link href="/register" className="flex-1">
                  <Button variant="outline" className="w-full" onClick={() => TeamService.storePendingInvitation(token!)}>
                    Register
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <Button className="w-full" onClick={handleAccept} disabled={processing}>
              {processing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Accepting...
                </>
              ) : (
                <>
                  <UserPlus className="mr-2 h-4 w-4" />
                  Accept Invitation
                </>
              )}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </CardContent>
        </Card>
      </div>
    }>
      <AcceptInvitationContent />
    </Suspense>
  )
}

