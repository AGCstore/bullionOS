import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import {
  DisplayCategoriesController,
  PublicDisplayCategoriesController,
} from './display-categories.controller';

@Module({
  controllers: [
    SettingsController,
    DisplayCategoriesController,
    PublicDisplayCategoriesController,
  ],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
