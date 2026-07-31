import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LanguageService } from '../../../core/services/language.service';

@Component({
  selector: 'app-lang-switch',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './lang-switch.component.html',
  styleUrls: ['./lang-switch.component.scss'],
})
export class LangSwitchComponent {
  private lang = inject(LanguageService);

  get current() {
    return this.lang.current;
  }

  set(lang: 'es' | 'en') {
    this.lang.setLocal(lang);
  }
}
