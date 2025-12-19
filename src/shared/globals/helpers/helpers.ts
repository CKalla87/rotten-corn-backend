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
   * @param initials - User initials to display
   * @param backgroundColor - Background color for the avatar
   * @param textColor - Text color (default: white)
   * @returns Data URI string for avatar image
   */
  static generateInitialsAvatar(initials: string, backgroundColor: string, textColor = '#FFFFFF'): string {
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
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }
}
