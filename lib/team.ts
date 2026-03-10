import pb from './pocketbase';
import { Team, TeamMember, TeamInvitation } from './types';

export class TeamService {
  private static INVITATION_STORAGE_KEY = 'pending_team_invitation';

  /**
   * Create team via API route (uses admin authentication)
   */
  static async createTeam(name: string): Promise<Team> {
    const user = pb.authStore.model;
    if (!user) throw new Error('User must be authenticated');

    try {
      const response = await fetch('/api/team/create-team', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.id,
          teamName: name,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create team');
      }

      const data = await response.json();
      return data.team;
    } catch (error: unknown) {
      console.error('Error creating team:', error);
      throw error;
    }
  }

  /**
   * Get user's team and members via API route (uses admin authentication)
   */
  static async getUserTeam(): Promise<{ team: Team; members: TeamMember[] } | null> {
    const user = pb.authStore.model;
    if (!user) return null;

    try {
      const response = await fetch('/api/team/get-team', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.id,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch team data');
      }

      const data = await response.json();
      
      if (!data.team) {
        return null;
      }

      return {
        team: data.team,
        members: data.members,
      };
    } catch (error: unknown) {
      console.error('Error fetching team data:', error);
      return null;
    }
  }

  static async inviteTeamMember(teamId: string, email: string): Promise<void> {
    const user = pb.authStore.model;
    if (!user) throw new Error('User must be authenticated');

    const token = this.generateInvitationToken();
    // Set expiry to 100 years in the future (effectively never expires)
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 100);

    const invitation = await pb.collection('team_invitations').create<TeamInvitation>({
      team: teamId,
      email,
      invited_by: user.id,
      token,
      expires: expiresAt.toISOString(),
      status: 'pending',
    });

    const invitationLink = `${window.location.origin}/invite/accept?token=${token}`;
    
    // Send email in background (don't wait for it)
    fetch('/api/team/invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        invitationLink,
        teamId,
        invitationId: invitation.id,
      }),
    }).catch(error => console.error('Failed to send invitation email:', error));
  }

  /**
   * Get team invitations via API route (uses admin authentication)
   */
  static async getTeamInvitations(teamId: string): Promise<TeamInvitation[]> {
    try {
      const response = await fetch('/api/team/get-invitations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          teamId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch invitations');
      }

      const data = await response.json();
      return data.invitations || [];
    } catch (error: unknown) {
      console.error('Error fetching invitations:', error);
      return [];
    }
  }

  /**
   * Get invitation by token via API route (requires superadmin authorization)
   */
  static async getInvitationByTokenAsAdmin(token: string): Promise<TeamInvitation | null> {
    try {
      const response = await fetch(`/api/team/invitation?token=${encodeURIComponent(token)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch invitation');
      }

      const data = await response.json();
      return data.invitation;
    } catch (error: unknown) {
      console.error('Error fetching invitation as admin:', error);
      throw error;
    }
  }

  /**
   * Accept invitation via API route (uses admin authentication)
   */
  static async acceptInvitation(token: string): Promise<void> {
    const user = pb.authStore.model;
    if (!user) {
      this.storePendingInvitation(token);
      throw new Error('User must be authenticated');
    }

    try {
      const response = await fetch('/api/team/accept-invitation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          userId: user.id,
          userEmail: user.email,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to accept invitation');
      }

      this.clearPendingInvitation();
    } catch (error: unknown) {
      console.error('Error accepting invitation:', error);
      throw error;
    }
  }

  /**
   * Remove team member via API route (uses admin authentication)
   */
  static async removeMember(memberId: string): Promise<void> {
    const user = pb.authStore.model;
    if (!user) throw new Error('User must be authenticated');

    try {
      const response = await fetch('/api/team/remove-member', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          memberId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to remove member');
      }
    } catch (error: unknown) {
      console.error('Error removing member:', error);
      throw error;
    }
  }

  /**
   * Cancel invitation via API route (uses admin authentication)
   */
  static async cancelInvitation(invitationId: string): Promise<void> {
    try {
      const response = await fetch('/api/team/cancel-invitation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          invitationId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to cancel invitation');
      }
    } catch (error: unknown) {
      console.error('Error cancelling invitation:', error);
      throw error;
    }
  }

  static storePendingInvitation(token: string): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem(this.INVITATION_STORAGE_KEY, token);
    }
  }

  static getPendingInvitation(): string | null {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(this.INVITATION_STORAGE_KEY);
    }
    return null;
  }

  /**
   * Get the email from a pending invitation
   */
  static async getPendingInvitationEmail(): Promise<string | null> {
    const token = this.getPendingInvitation();
    if (!token) return null;

    try {
      const invitation = await this.getInvitationByTokenAsAdmin(token);
      return invitation?.email || null;
    } catch {
      return null;
    }
  }

  static clearPendingInvitation(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(this.INVITATION_STORAGE_KEY);
    }
  }

  static async processPendingInvitation(): Promise<boolean> {
    const token = this.getPendingInvitation();
    if (!token) return false;

    try {
      await this.acceptInvitation(token);
      return true;
    } catch (error) {
      console.error('Failed to process pending invitation:', error);
      this.clearPendingInvitation();
      return false;
    }
  }

  private static generateInvitationToken(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}

