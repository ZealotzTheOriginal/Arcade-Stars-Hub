import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';
import { LangSwitchComponent } from '../../../shared/components/lang-switch/lang-switch.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, LangSwitchComponent],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private translate = inject(TranslateService);

  email = '';
  password = '';
  loading = signal(false);
  error = signal('');

  async onSubmit() {
    this.error.set('');
    this.loading.set(true);
    try {
      await this.auth.login(this.email, this.password);
      this.router.navigate(['/home']);
    } catch (e: any) {
      this.error.set(this._friendlyError(e.code));
    } finally {
      this.loading.set(false);
    }
  }

  private _friendlyError(code: string): string {
    const map: Record<string, string> = {
      'auth/invalid-credential': 'AUTH.ERRORS.INVALID_CREDENTIAL',
      'auth/user-not-found': 'AUTH.ERRORS.USER_NOT_FOUND',
      'auth/too-many-requests': 'AUTH.ERRORS.TOO_MANY_REQUESTS',
    };
    return this.translate.instant(map[code] ?? 'AUTH.ERRORS.LOGIN_FAILED');
  }
}
