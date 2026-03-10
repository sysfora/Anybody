export interface User {
  id: string;
  email: string;
  name: string;
  username: string;
  avatar?: string;
  verified: boolean;
  is_superadmin?: boolean;
  created: string;
  updated: string;
}

export interface AuthResponse {
  token: string;
  record: User;
}

export interface AuthError {
  message: string;
  data?: {
    email?: {
      code: string;
      message: string;
    };
    password?: {
      code: string;
      message: string;
    };
  };
}

export interface Team {
  id: string;
  name: string;
  owner: string;
  created: string;
  updated: string;
}

export interface TeamMember {
  id: string;
  team: string;
  user: string;
  role: 'owner' | 'member';
  status: 'active' | 'pending';
  created: string;
  updated: string;
  expand?: {
    user?: User;
    team?: Team;
  };
}

export interface TeamInvitation {
  id: string;
  team: string;
  email: string;
  invited_by: string;
  token: string;
  expires: string;
  status: 'pending' | 'accepted' | 'expired';
  created: string;
  updated: string;
  expand?: {
    team?: Team;
    invited_by?: User;
  };
}