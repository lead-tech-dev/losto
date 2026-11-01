import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AccountService } from './account.service';
import { AuthService } from './auth.service';
import { AuthUser, CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { ChangePasswordDto, ForgotPasswordDto, ResetPasswordDto, UpdateProfileDto } from './dto/account.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterFamilyDto } from './dto/register-family.dto';

const STRICT = { default: { ttl: 60_000, limit: 10 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly account: AccountService,
  ) {}

  @Public()
  @Throttle(STRICT)
  @Post('register')
  register(@Body() dto: RegisterFamilyDto) {
    return this.auth.registerFamily(dto);
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @Patch('me')
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.account.updateProfile(user.id, dto);
  }

  @HttpCode(204)
  @Post('change-password')
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    await this.account.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @HttpCode(202)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.account.forgotPassword(dto.email);
    return { message: 'Si un compte existe pour cette adresse, un e-mail vient d’être envoyé.' };
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(204)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.account.resetPassword(dto.token, dto.password);
  }
}
