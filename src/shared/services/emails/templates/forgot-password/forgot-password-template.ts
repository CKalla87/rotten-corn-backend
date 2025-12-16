import fs from 'fs';
import ejs from 'ejs';

class ForgotPasswordTemplate {
  public passwordResetTemplate(username: string, resetLink: string): string {
    return ejs.render(fs.readFileSync(__dirname + '/forgot-password-template.ejs', 'utf8'), {
      username,
      resetLink,
      image_url: 'https://png.pngtree.com/png-vector/20190115/ourmid/pngtree-vector-lock-icon-png-image_318067.jpg'
    });
  }

}

export const forgotPasswordTemplate: ForgotPasswordTemplate = new ForgotPasswordTemplate();
