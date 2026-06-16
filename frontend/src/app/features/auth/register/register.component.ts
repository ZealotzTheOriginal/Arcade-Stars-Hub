import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.scss'],
})
export class RegisterComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  displayName = '';
  email = '';
  password = '';
  loading = signal(false);
  error = signal('');

  async onSubmit() {
    if (this.password.length < 6) {
      this.error.set('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    this.error.set('');
    this.loading.set(true);
    try {
      await this.auth.register(this.email, this.password, this.displayName);
      this.router.navigate(['/home']);
    } catch (e: any) {
      const map: Record<string, string> = {
        'auth/email-already-in-use': 'Ya existe una cuenta con ese email.',
        'auth/weak-password': 'Contraseña demasiado débil.',
      };
      this.error.set(map[e.code] ?? 'Error al registrarse.');
    } finally {
      this.loading.set(false);
    }
  }
}
