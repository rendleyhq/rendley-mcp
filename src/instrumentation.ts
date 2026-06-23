import logsAPI from "@opentelemetry/api-logs";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { detectResources } from "@opentelemetry/resources";
import {
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";

if (process.env.OTEL_ENABLED === "true") {
  const loggerProvider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor(new OTLPLogExporter())],
  });

  logsAPI.logs.setGlobalLoggerProvider(loggerProvider);

  const sdk = new NodeSDK({
    resource: detectResources(),
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 60000,
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
}
