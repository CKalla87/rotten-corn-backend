import fs from 'fs';
import ejs from 'ejs';
import { IResetPasswordParams } from '@user/interfaces/user.interface';

class ResetPasswordTemplate {
  public passwordResetConfirmationTemplate(templateParams: IResetPasswordParams): string {
    const { username, email, ipaddress, date } = templateParams;
    return ejs.render(fs.readFileSync(__dirname + '/reset-password-template.ejs', 'utf8'), {
      username,
      email,
      ipaddress,
      date,
      image_url: 'https://png.pngtree.com/png-vector/20190115/ourmid/pngtree-vector-lock-icon-png-image_318067.jpg'
    });
  }

}

export const resetPasswordTemplate: ResetPasswordTemplate = new ResetPasswordTemplate();
