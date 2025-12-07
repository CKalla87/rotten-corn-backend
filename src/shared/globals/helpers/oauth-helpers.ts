import { floor, random } from 'lodash';
import { Helpers } from './helpers';

/**
 * Generate a random avatar color from a predefined palette
 * @returns Hex color string
 */
export function generateAvatarColor(): string {
  const colors: string[] = [
    '#f44336',
    '#e91e63',
    '#2196f3',
    '#9c27b0',
    '#3f51b5',
    '#00bcd4',
    '#4caf50',
    '#ff9800',
    '#8bc34a',
    '#009688',
    '#03a9f4',
    '#cddc39',
    '#2962ff',
    '#448aff',
    '#84ffff',
    '#00e676',
    '#43a047',
    '#d32f2f',
    '#ff1744',
    '#ad1457',
    '#6a1b9a',
    '#1a237e',
    '#1de9b6',
    '#d84315'
  ];
  return colors[floor(random() * colors.length)];
}

/**
 * Generate a username from email or name
 * @param email - User's email address
 * @param name - User's display name (optional)
 * @returns Generated username
 */
export function generateUsername(email: string, name?: string): string {
  if (name) {
    // Use name, remove spaces, limit to 8 chars
    const baseUsername = name
      .toLowerCase()
      .replace(/\s+/g, '')
      .substring(0, 8);

    // If too short, pad with numbers
    if (baseUsername.length < 4) {
      const randomNum = floor(random() * 10000);
      return `${baseUsername}${randomNum}`.substring(0, 8);
    }

    return baseUsername.substring(0, 8);
  }

  // Use email prefix, limit to 8 chars
  const emailPrefix = email.split('@')[0].toLowerCase().substring(0, 8);

  // If too short, pad with numbers
  if (emailPrefix.length < 4) {
    const randomNum = floor(random() * 10000);
    return `${emailPrefix}${randomNum}`.substring(0, 8);
  }

  return emailPrefix.substring(0, 8);
}

/**
 * Generate an avatar image data URI using initials
 * @param name - User's name or email
 * @param avatarColor - Background color for avatar
 * @returns Data URI string for avatar image
 */
export function generateAvatarImage(name: string, avatarColor: string): string {
  const initials = Helpers.generateUserInitials(name);
  return Helpers.generateInitialsAvatar(initials, avatarColor);
}
