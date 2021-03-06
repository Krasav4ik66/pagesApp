import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { GoogleUserDTO, LoginDTO, RegisterDTO } from './dto/auth.dto';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import * as crypto from 'crypto';
import * as uniqid from 'uniqid';
import { MailService } from '../mail/mail.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { responseUserDto } from './dto/response-user.dto';
import { User } from '../interfaces/user';

@Controller('auth')
@UseInterceptors(ClassSerializerInterceptor)
export class AuthController {
  constructor(
    private userService: UsersService,
    private authService: AuthService,
    private mailService: MailService,
  ) {}

  @Get()
  @UseGuards(AuthGuard('jwt'))
  tempAuth() {
    return { auth: 'works' };
  }

  @UseInterceptors(ClassSerializerInterceptor)
  @Post('login')
  async login(@Body() userDTO: LoginDTO): Promise<Record<string, any>> {
    const user = await this.userService.findByLogin(userDTO);
    if (user.confirmed == false)
      throw new HttpException(
        'Your account not confirmed',
        HttpStatus.BAD_REQUEST,
      );
    const payload = {
      firstName: user.firstName,
      lastName: user.lastName,
    };

    const token = await this.authService.signPayload(payload);
    const responseUser = new responseUserDto(user);
    return { user: responseUser, token, message: 'Login successfully' };
  }

  @UseInterceptors(ClassSerializerInterceptor)
  @Post('register')
  async register(@Body() userDTO: RegisterDTO): Promise<Record<string, any>> {
    const containsNumbers = /^.*\d+.*$/;
    const containsLetters = /^.*[a-zA-Z]+.*$/;
    if (!containsNumbers.test(userDTO.password))
      throw new HttpException(
        'Password must contain numbers',
        HttpStatus.BAD_REQUEST,
      );

    if (!containsLetters.test(userDTO.password))
      throw new HttpException(
        'Password must contain letters',
        HttpStatus.BAD_REQUEST,
      );

    const resetToken = crypto.randomBytes(32).toString('hex');
    const user = await this.userService.create(userDTO, resetToken);
    const payload = {
      firstName: user.firstName,
      lastName: user.lastName,
    };

    await this.mailService.sendUserConfirmation(user, resetToken);
    const token = await this.authService.signPayload(payload);
    return { message: 'Confirm your email' };
  }

  @Get('/confirm/:token')
  async confirm(@Param('token') token: string): Promise<string> {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const user = await this.userService.findByResetToken(
      hashedToken,
      Date.now(),
    );
    await user.save();
    return 'User confirmed<script>setTimeout(() => window.close(), 2000);</script>';
  }

  @Post('/forgotPassword')
  async forgotPassword(
    @Body(new ValidationPipe()) forgotPasswordDto: ForgotPasswordDto,
  ): Promise<Record<string, any>> {
    const user = await this.userService.findByEmail(forgotPasswordDto.email);
    if (!user) throw new HttpException('Invalid email', HttpStatus.BAD_REQUEST);
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.passwordResetToken = resetToken;
    user.passwordResetExpires = Date.now() + 10 * 60 * 1000;
    await user.save({ validateBeforeSave: false });
    try {
      await this.mailService.sendChangePasswordEmail(user, resetToken);
      return { message: 'Confirming message has been sent to the email' };
    } catch (err) {
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });
      throw new HttpException(
        'Error sending the email',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('/reset/:token')
  async resetPassword(
    @Param('token') token: string,
    @Body() changePasswordDto: ChangePasswordDto,
  ): Promise<Record<string, any>> {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    return this.userService.changePassword(
      hashedToken,
      Date.now(),
      changePasswordDto,
    );
  }

  @UseInterceptors(ClassSerializerInterceptor)
  @Post('googleAuth')
  async googleLogin(
    @Body() userDTO: GoogleUserDTO,
  ): Promise<Record<string, any>> {
    // const decodedToken = jwt_decode()
    let user;
    user = await this.userService.findByEmail(userDTO.email);
    if (!user) {
      user = await this.userService.createGoogleUser(userDTO);
    }
    const payload = {
      firstName: user.firstName,
      lastName: user.lastName,
    };

    const token = await this.authService.signPayload(payload);
    const responseUser = new responseUserDto(user);
    return { user: responseUser, token, message: 'Login successfully' };
  }

  @Get('/reset/:token')
  async checkToken(@Param('token') token: string): Promise<void> {
    const user = await this.userService.findByResetToken(token, Date.now());
  }
}
