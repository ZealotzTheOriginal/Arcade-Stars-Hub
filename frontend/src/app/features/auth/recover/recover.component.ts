import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-recover',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './recover.component.html',
  styleUrls: ['./recover.component.scss'],
})
export class RecoverComponent {
  private auth = inject(AuthService);

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
      this.error.set('No se pudo enviar el correo. Verifica el email.');
    } finally {
      this.loading.set(false);
    }
  }
}
