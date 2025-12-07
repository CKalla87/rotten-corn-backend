export class Helpers {
  static firstLetterUppercase(str: string): string {
    const valueString = str.toLowerCase();
    return valueString
      .split(' ')
      .map((value: string) => `${value.charAt(0).toUpperCase()}${value.slice(1).toLocaleLowerCase()}`)
      .join(' ');
  }

  static lowerCase(str: string): string {
    return str.toLowerCase();
  }

  static generateRandomIntegers(integerLength: number): number {
    const characters = '0123456789';
    let result = ' ';
    const charactersLength = characters.length;
    for (let i = 0; i < integerLength; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return parseInt(result, 10);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static parseJson(prop: string): any {
    try {
      return JSON.parse(prop);
    } catch (error) {
      return prop;
    }
  }

  static isDataURL(value: string): boolean {
    const dataURLRegex = /^\s*data:([a-z]+\/[a-z0-9-+.]+(;[a-z-]+=[a-z0-9-]+)?)?(;base64)?,([a-z0-9!$&',()*+;=\-._~:@\\/?%\s]*)\s*$/i;
    return dataURLRegex.test(value);
  }

  static isCloudinaryUrl(value: string): boolean {
    return /^https?:\/\/res\.cloudinary\.com\//.test(value);
  }

  static shuffle<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  static escapeRegex(text: string): string {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
  }

  /**
   * Generate user initials from username
   * @param username - The username to generate initials from
   * @returns Initials (e.g., "John Doe" -> "JD", "john" -> "J")
   */
  static generateUserInitials(username: string | undefined): string {
    if (!username || username.trim().length === 0) {
      return '?';
    }

    const parts = username.trim().split(/\s+/);
    if (parts.length >= 2) {
      // First letter of first word + first letter of last word
      return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    } else {
      // Single word - take first letter, or first two if very short
      const word = parts[0];
      if (word.length >= 2) {
        return word.substring(0, 2).toUpperCase();
      }
      return word.charAt(0).toUpperCase();
    }
  }

  /**
   * Generate a data URI for an initials avatar
   * Creates an SVG with the user's initials and avatar color
   * @param initials - User initials to display
   * @param backgroundColor - Background color (hex code)
   * @param textColor - Text color (defaults to white)
   * @returns Data URI string
   */
  static generateInitialsAvatar(initials: string, backgroundColor: string, textColor: string = '#FFFFFF'): string {
    const size = 200;
    const fontSize = size * 0.4;
    
    const svg = `
      <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${size}" height="${size}" fill="${backgroundColor}"/>
        <text 
          x="50%" 
          y="50%" 
          font-family="Arial, sans-serif" 
          font-size="${fontSize}" 
          font-weight="bold" 
          fill="${textColor}" 
          text-anchor="middle" 
          dominant-baseline="central"
        >${initials}</text>
      </svg>
    `.trim();

    // Convert SVG to data URI
    const encodedSvg = encodeURIComponent(svg);
    return `data:image/svg+xml,${encodedSvg}`;
  }

  /**
   * Check if a profile picture URL is valid or should be replaced with initials
   * @param profilePicture - The profile picture URL
   * @returns true if the URL is valid, false if it should be replaced
   */
  static isProfilePictureValid(profilePicture: string | undefined | null): boolean {
    if (!profilePicture || profilePicture.trim().length === 0) {
      return false;
    }

    // Check if it's already a data URI (initials avatar) - these are always valid
    if (Helpers.isDataURL(profilePicture)) {
      return true;
    }

    // Check if it's a valid Cloudinary URL format
    if (Helpers.isCloudinaryUrl(profilePicture)) {
      // Check for common broken URL patterns
      const brokenPatterns = [
        /\/vundefined\//,
        /\/undefined\//,
        /\/vnull\//,
        /\/null\//,
        /res\.cloudingary\.com/, // Common typo
        /res\/cloudingary\.com/, // Another typo
        /\/v0\//, // Version 0 often indicates missing/placeholder images
      ];
      
      for (const pattern of brokenPatterns) {
        if (pattern.test(profilePicture)) {
          return false;
        }
      }
      
      // URL format is valid - actual existence will be checked in normalization
      return true;
    }

    // If it's not a data URI or Cloudinary URL, consider it invalid
    return false;
  }

  /**
   * Normalize a user's profile picture - replace broken/invalid URLs with initials avatar
   * @param profilePicture - Current profile picture URL
   * @param username - User's username for generating initials
   * @param avatarColor - User's avatar color for the background
   * @returns Normalized profile picture URL (either original or initials avatar)
   */
  static normalizeProfilePicture(
    profilePicture: string | undefined | null,
    username: string | undefined,
    avatarColor: string | undefined
  ): string {
    // First check if profile picture is invalid or empty
    if (!Helpers.isProfilePictureValid(profilePicture)) {
      const initials = Helpers.generateUserInitials(username);
      const backgroundColor = avatarColor || '#6C757D';
      return Helpers.generateInitialsAvatar(initials, backgroundColor);
    }

    // If it's already a data URI (initials avatar), return it as-is
    if (profilePicture && Helpers.isDataURL(profilePicture)) {
      return profilePicture;
    }

    // For Cloudinary URLs, check for suspicious patterns that might indicate broken images
    if (profilePicture && Helpers.isCloudinaryUrl(profilePicture)) {
      const urlParts = profilePicture.match(/\/image\/upload\/v\d+\/([^/?]+)/);
      if (urlParts && urlParts[1]) {
        const publicId = urlParts[1];
        
        // Check if public_id looks like a MongoDB ObjectId (24 hex characters)
        // This pattern often indicates the image was never properly uploaded
        const objectIdPattern = /^[a-f\d]{24}$/i;
        if (objectIdPattern.test(publicId)) {
          // This is suspicious - ObjectIds shouldn't typically be used as Cloudinary public_ids
          // Default to initials to avoid 404 errors
          const initials = Helpers.generateUserInitials(username);
          const backgroundColor = avatarColor || '#6C757D';
          return Helpers.generateInitialsAvatar(initials, backgroundColor);
        }
      }
    }

    // URL appears valid and not suspicious, return it
    return profilePicture || '';
  }
}
