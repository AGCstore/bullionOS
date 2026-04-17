import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokensService } from './tokens.service';
import { TwoFactorService } from './twofa.service';
import { TwoFactorController } from './twofa.controller';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    // Per-sign options are provided at call sites (TokensService) so we can
    // use different secrets + TTLs for access vs refresh tokens.
    JwtModule.register({}),
  ],
  controllers: [AuthController, TwoFactorController],
  providers: [AuthService, TokensService, TwoFactorService, JwtStrategy],
  exports: [AuthService, TokensService, TwoFactorService],
})
export class AuthModule {}
