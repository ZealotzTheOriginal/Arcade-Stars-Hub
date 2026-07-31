import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './empty-state.component.html',
  styleUrls: ['./empty-state.component.scss'],
})
export class EmptyStateComponent {
  @Input() icon = '✨';
  @Input() title = '';
  @Input() subtitle = '';
  @Input() actionLabel?: string;
  /** Single-line, low-emphasis variant for spots that shouldn't compete with a nearby full empty state. */
  @Input() compact = false;

  @Output() action = new EventEmitter<void>();
}
