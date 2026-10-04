//! The `tracing` layer that turns every event into one [`LogSink`] line.
//!
//! The engine logs with `tracing`'s macros everywhere (`tracing::warn!(endpoint = %e, "api call failed")`);
//! this layer collects the event's fields plus the fields of every span it is inside (the TypeScript
//! logger's `child({ component })`), and hands them to the sink, which scrubs and redacts them. Events from
//! other crates (hyper, h2, rustls) are kept only at `warn` and above, so the file stays the engine's.

use std::fmt;
use std::sync::Arc;

use serde_json::{Number, Value};
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing::{Event, Metadata, Subscriber};
use tracing_subscriber::layer::{Context, Layer};
use tracing_subscriber::registry::LookupSpan;

use super::sink::{Fields, LogLevel, LogSink, set_field};

/// Targets that are the app's own: everything else is `warn` and above only.
const OWN_TARGETS: &[&str] = &["engine", "kustom"];

fn is_own(target: &str) -> bool {
    OWN_TARGETS.iter().any(|own| target.starts_with(own))
}

/// Collects one event's or span's fields.
#[derive(Default)]
struct Collect {
    message: Option<String>,
    fields: Fields,
}

impl Collect {
    fn put(&mut self, field: &Field, value: Value) {
        if field.name() == "message" {
            self.message = Some(match value {
                Value::String(text) => text,
                other => other.to_string(),
            });
        } else {
            set_field(&mut self.fields, field.name(), value);
        }
    }
}

impl Visit for Collect {
    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        self.put(field, Value::String(format!("{value:?}")));
    }
    fn record_str(&mut self, field: &Field, value: &str) {
        self.put(field, Value::String(value.to_owned()));
    }
    fn record_i64(&mut self, field: &Field, value: i64) {
        self.put(field, Value::Number(value.into()));
    }
    fn record_u64(&mut self, field: &Field, value: u64) {
        self.put(field, Value::Number(value.into()));
    }
    fn record_f64(&mut self, field: &Field, value: f64) {
        self.put(
            field,
            Number::from_f64(value).map_or_else(|| Value::String(value.to_string()), Value::Number),
        );
    }
    fn record_bool(&mut self, field: &Field, value: bool) {
        self.put(field, Value::Bool(value));
    }
    fn record_error(&mut self, field: &Field, value: &(dyn std::error::Error + 'static)) {
        self.put(field, Value::String(value.to_string()));
    }
}

/// A span's fields, kept in its extensions.
struct SpanFields(Fields);

/// The layer. Build it with [`super::layer`].
pub struct KustomLayer {
    sink: Arc<LogSink>,
}

impl KustomLayer {
    /// A layer writing to `sink`.
    pub fn new(sink: Arc<LogSink>) -> Self {
        KustomLayer { sink }
    }

    fn wants(&self, metadata: &Metadata<'_>) -> bool {
        let level = LogLevel::from_tracing(metadata.level());
        if is_own(metadata.target()) {
            level >= self.sink.min_level()
        } else {
            level >= LogLevel::Warn.max(self.sink.min_level())
        }
    }
}

impl<S> Layer<S> for KustomLayer
where
    S: Subscriber + for<'a> LookupSpan<'a>,
{
    fn enabled(&self, metadata: &Metadata<'_>, _ctx: Context<'_, S>) -> bool {
        // Spans are always kept: their fields are context for events inside them.
        metadata.is_span() || self.wants(metadata)
    }

    fn on_new_span(&self, attrs: &Attributes<'_>, id: &Id, ctx: Context<'_, S>) {
        let mut collect = Collect::default();
        attrs.record(&mut collect);
        if let Some(span) = ctx.span(id) {
            span.extensions_mut().insert(SpanFields(collect.fields));
        }
    }

    fn on_record(&self, id: &Id, values: &Record<'_>, ctx: Context<'_, S>) {
        let mut collect = Collect::default();
        values.record(&mut collect);
        if let Some(span) = ctx.span(id) {
            let mut extensions = span.extensions_mut();
            if let Some(SpanFields(fields)) = extensions.get_mut::<SpanFields>() {
                for (key, value) in collect.fields {
                    set_field(fields, &key, value);
                }
            }
        }
    }

    fn on_event(&self, event: &Event<'_>, ctx: Context<'_, S>) {
        if !self.wants(event.metadata()) {
            return;
        }
        let mut fields: Fields = Vec::new();
        if let Some(scope) = ctx.event_scope(event) {
            for span in scope.from_root() {
                if let Some(SpanFields(span_fields)) = span.extensions().get::<SpanFields>() {
                    for (key, value) in span_fields {
                        set_field(&mut fields, key, value.clone());
                    }
                }
            }
        }
        let mut collect = Collect::default();
        event.record(&mut collect);
        for (key, value) in collect.fields {
            set_field(&mut fields, &key, value);
        }
        let message = collect.message.unwrap_or_default();
        self.sink
            .write(LogLevel::from_tracing(event.metadata().level()), &message, fields);
    }
}
