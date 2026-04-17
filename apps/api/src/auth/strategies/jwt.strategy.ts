import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { RequestUser } from '../../common/decorators/current-user.decorator';
import type { UserRole } from '../../db/types';

interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  typ: 'access';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      // Lock down algorithm — do not accept anything weaker.
      algorithms: ['HS256'],
    });
  }

  // Return value is attached to req.user by passport.
  validate(payload: AccessTokenPayload): RequestUser {
    if (payload.typ !== 'access') {
      throw new UnauthorizedException('Wrong token type');
    }
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
