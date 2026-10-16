//! `app mailbox …`: the dev mailbox from a terminal, for humans and agents without a browser.
//! It reads the same `mailbox_messages` table as `/dev/mailbox`, so mail from any process shows.
//! GUIDE: .offrails/guides/mailers.md#for-agents

use std::time::Duration;

use clap::Subcommand;
use sea_orm::DatabaseConnection;

use crate::kernel::mailbox::{self, Filter, Model};

#[derive(Debug, Subcommand)]
pub enum MailboxCommand {
    /// Print new mail as it arrives (Ctrl-C stops), with its links and codes.
    Tail {
        /// Only mail to this address.
        #[arg(long)]
        to: Option<String>,
    },
    /// The newest messages, one line each.
    List {
        #[arg(long)]
        to: Option<String>,
        #[arg(long, default_value_t = 20)]
        limit: u64,
    },
    /// One message as JSON (the same shape as /dev/mailbox/latest.json); the newest without an id.
    Show { id: Option<i64> },
    /// Delete every message.
    Clear,
}

pub async fn run(db: &DatabaseConnection, command: MailboxCommand) -> anyhow::Result<()> {
    match command {
        MailboxCommand::Tail { to } => tail(db, to).await,
        MailboxCommand::List { to, limit } => {
            let filter = Filter {
                to,
                ..Filter::default()
            };
            for m in mailbox::filter(db, &filter, limit).await?.iter().rev() {
                println!("{}", line(m));
            }
            Ok(())
        }
        MailboxCommand::Show { id } => {
            let m = match id {
                Some(id) => mailbox::find(db, id).await?,
                None => mailbox::latest(db, None).await?,
            };
            let m = m.ok_or_else(|| anyhow::anyhow!("no such message"))?;
            println!(
                "{}",
                serde_json::to_string_pretty(&mailbox::summary_json(&m))?
            );
            Ok(())
        }
        MailboxCommand::Clear => {
            println!("cleared {} message(s)", mailbox::clear(db).await?);
            Ok(())
        }
    }
}

/// `#12  14:03:22  ada@example.com  Your sign-in link`
fn line(m: &Model) -> String {
    format!(
        "#{:<5} {}  {}  {}",
        m.id,
        m.created_at.format("%H:%M:%S"),
        m.to_addr,
        m.subject
    )
}

async fn tail(db: &DatabaseConnection, to: Option<String>) -> anyhow::Result<()> {
    let mut since = mailbox::newest_id(db).await?;
    eprintln!("waiting for mail (Ctrl-C stops)…");
    loop {
        let filter = Filter {
            to: to.clone(),
            since: Some(since),
            ..Filter::default()
        };
        // WHY: oldest first, so a burst prints in the order it was sent.
        for m in mailbox::filter(db, &filter, 100).await?.iter().rev() {
            println!("{}", line(m));
            for code in mailbox::codes_in(&m.text) {
                println!("        code  {code}");
            }
            for link in mailbox::links_in(&m.text, &m.html) {
                println!("        link  {link}");
            }
            since = since.max(m.id);
        }
        tokio::select! {
            _ = tokio::signal::ctrl_c() => return Ok(()),
            _ = tokio::time::sleep(Duration::from_secs(1)) => {}
        }
    }
}
