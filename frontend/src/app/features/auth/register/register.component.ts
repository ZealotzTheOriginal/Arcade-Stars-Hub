import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';
import { LangSwitchComponent } from '../../../shared/components/lang-switch/lang-switch.component';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, LangSwitchComponent],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.scss'],
})
export class RegisterComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private translate = inject(TranslateService);

  displayName = '';
  email = '';
  password = '';
  loading = signal(false);
  error = signal('');

  async onSubmit() {
    if (this.password.length < 6) {
      this.error.set(this.translate.instant('AUTH.ERRORS.PASSWORD_TOO_SHORT'));
      return;
    }
    this.error.set('');
    this.loading.set(true);
    try {
      await this.auth.register(this.email, this.password, this.displayName);
      this.router.navigate(['/home']);
    } catch (e: any) {
      const map: Record<string, string> = {
        'auth/email-already-in-use': 'AUTH.ERRORS.EMAIL_IN_USE',
        'auth/weak-password': 'AUTH.ERRORS.WEAK_PASSWORD',
      };
      this.error.set(this.translate.instant(map[e.code] ?? 'AUTH.ERRORS.REGISTER_FAILED'));
    } finally {
      this.loading.set(false);
    }
  }
}
