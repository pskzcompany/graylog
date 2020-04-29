export enum GraylogLevelEnum {
  /** system is unusable */
  EMERG = 0,
  /** action must be taken immediately */
  ALERT = 1,
  /** critical conditions */
  CRIT = 2,
  /** error conditions */
  ERR = 3,
  /** warning conditions */
  WARNING = 4,
  /** normal, but significant, condition */
  NOTICE = 5,
  /** informational message */
  INFO = 6,
  /** debug level message */
  DEBUG = 7,
}

/**
 * GELF Payload Specification, Version 1.1 (11/2013)
 * @see http://docs.graylog.org/en/3.0/pages/gelf.html#gelf-payload-specification
 */
export interface GraylogGelfPayload {
  /** GELF spec version – “1.1”; MUST be set by client library. */
  version: string;
  /** the name of the host, source or application that sent this message; MUST be set by client library. */
  host: string;
  /** a short descriptive message; MUST be set by client library. */
  short_message: string;
  /** a long message that can i.e. contain a backtrace; optional. */
  full_message?: string;
  /** Seconds since UNIX epoch with optional decimal places for milliseconds; SHOULD be set by client library. Will be set to the current timestamp (now) by the server if absent. */
  timestamp?: number;
  /** the level equal to the standard syslog levels; optional, default is 1 (ALERT) */
  level?: GraylogLevelEnum;
  /** optional, @deprecated. Send as additional field instead. */
  facility?: string;
  /** the line in a file that caused the error (decimal); optional, @deprecated. Send as additional field instead. */
  line?: number;
  /** the file (with path if you want) that caused the error (string); optional, @deprecated. Send as additional field instead. */
  file?: string;
  /** every field you send and prefix with an underscore (_) will be treated as an additional field.
   * Allowed characters in field names are any word character (letter, number, underscore), dashes and dots.
   * The verifying regular expression is: ^[\w\.\-]*$.
   * Libraries SHOULD not allow to send id as additional field (_id).
   * Graylog server nodes omit this field automatically.
   */
  [_propName: string]: GraylogGelfAdditionalField;
}

export type GraylogGelfAdditionalField = string | number | Date | undefined;
