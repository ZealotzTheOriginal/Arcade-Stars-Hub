import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';
import { LangSwitchComponent } from '../../../shared/components/lang-switch/lang-switch.component';

@Component({
  selector: 'app-recover',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, LangSwitchComponent],
  templateUrl: './recover.component.html',
  styleUrls: ['./recover.component.scss'],
})
export class RecoverComponent {
  private auth = inject(AuthService);
  private translate = inject(TranslateService);

  email = '';
  loading = signal(false);
  success = signal(false);
  error = signal('');

  async onSubmit() {
    this.error.set('');
    this.loading.set(true);
    try {
      await this.auth.resetPassword(this.email);
      this.success.set(true);
    } catch {
      this.error.set(this.translate.instant('AUTH.ERRORS.RECOVER_FAILED'));
    } finally {
      this.loading.set(false);
    }
  }
}
