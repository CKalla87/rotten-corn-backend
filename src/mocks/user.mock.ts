import { IUserDocument } from '@user/interfaces/user.interface';

export const mockExistingUser = {
  notifications: {
    messages: true,
    reactions: true,
    comments: true,
    follows: true
  },
  social: {
    facebook: '',
    instagram: '',
    twitter: '',
    youtube: ''
  },
  blocked: [],
  blockedBy: [],
  followersCount: 1,
  followingCount: 2,
  postsCount: 2,
  bgImageVersion: '',
  bgImageId: '',
  profilePicture: 'http://place-hold.it/500X500',
  _id: '60263f14648fed5246e322d9',
  work: 'KickChat Inc.',
  school: 'University of Benin',
  location: 'Dusseldorf, Germany',
  quote: 'Sky is my limite',
  createdAt: new Date()
} as unknown as IUserDocument;

export const existingUser = {
  notifications: {
    messages: true,
    reactions: true,
    comments: true,
    follows: true
  },
  social: {
    facebook: '',
    instagram: '',
    twitter: '',
    youtube: ''
  },
  blocked: [],
  blockedBy: [],
  followersCount: 1,
  followingCount: 2,
  postsCount: 2,
  bgImageVersion: '',
  bgImageId: '',
  profilePicture: 'http://place-hold.it/500X500',
  _id: '60263f14648fed5246e322d9',
  work: 'KickChat Inc.',
  school: 'University of Benin',
  location: 'Dusseldorf, Germany',
  quote: 'Sky is my limite',
  createdAt: new Date()
} as unknown as IUserDocument;
