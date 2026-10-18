#!/usr/bin/env bash
# Creates the tables, topics and queues of PLANNING §3.1 and §3.2 when LocalStack starts.
# Every command is idempotent, so restarting the container with persisted data is safe.
set -euo pipefail

# A restart keeps the container filesystem: clear the marker so the healthcheck waits for us.
rm -f /tmp/alegra-lunch-ready

ACCOUNT=000000000000
REGION=us-east-1

# --- DynamoDB: one table per service, single-table design (pk + sk) ------------------------
for table in orders kitchen warehouse purchases connections assistant; do
  if ! awslocal dynamodb describe-table --table-name "$table" >/dev/null 2>&1; then
    awslocal dynamodb create-table \
      --table-name "$table" \
      --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
      --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
      --billing-mode PAY_PER_REQUEST >/dev/null
  fi
done

# --- SNS: a standard topic for every event, a FIFO topic only for StockShortage ------------
EVENTS_TOPIC=$(awslocal sns create-topic --name events --query TopicArn --output text)
SHORTAGES_TOPIC=$(awslocal sns create-topic --name shortages.fifo \
  --attributes FifoTopic=true --query TopicArn --output text)

# --- SQS: one queue per consumer, each with a DLQ that only gets invalid messages ----------
queue() {
  local name=$1 fifo=${2:-}
  local attributes='{}'
  if [[ -n $fifo ]]; then attributes='{"FifoQueue":"true"}'; fi
  awslocal sqs create-queue --queue-name "$name" --attributes "$attributes" >/dev/null
  echo "arn:aws:sqs:$REGION:$ACCOUNT:$name"
}

subscribe() {
  local topic=$1 queue_arn=$2 types=$3
  local existing
  existing=$(awslocal sns list-subscriptions-by-topic --topic-arn "$topic" \
    --query "Subscriptions[?Endpoint=='$queue_arn'].SubscriptionArn" --output text)
  if [[ -z $existing ]]; then
    existing=$(awslocal sns subscribe --topic-arn "$topic" --protocol sqs \
      --notification-endpoint "$queue_arn" --attributes RawMessageDelivery=true \
      --query SubscriptionArn --output text)
  fi
  # Each queue only gets the event types its service consumes.
  awslocal sns set-subscription-attributes --subscription-arn "$existing" \
    --attribute-name FilterPolicy --attribute-value "{\"type\":$types}"
}

for name in kitchen warehouse orders realtime; do
  queue "$name-dlq" >/dev/null
done
queue market-dlq.fifo fifo >/dev/null

KITCHEN=$(queue kitchen)
WAREHOUSE=$(queue warehouse)
ORDERS=$(queue orders)
REALTIME=$(queue realtime)
MARKET=$(queue market.fifo fifo)

subscribe "$EVENTS_TOPIC" "$KITCHEN" '["OrderPlaced","IngredientsReserved"]'
subscribe "$EVENTS_TOPIC" "$WAREHOUSE" '["WorkdayStarted","IngredientsRequested","IngredientPurchased"]'
subscribe "$EVENTS_TOPIC" "$ORDERS" \
  '["OrderPlaced","IngredientsRequested","OrderWaitingIngredients","IngredientsReserved","OrderDelivered"]'
subscribe "$EVENTS_TOPIC" "$REALTIME" \
  '["WorkdayStarted","OrderPlaced","IngredientsRequested","OrderWaitingIngredients","IngredientsReserved","IngredientPurchased","OrderDelivered"]'
subscribe "$SHORTAGES_TOPIC" "$MARKET" '["StockShortage"]'
subscribe "$SHORTAGES_TOPIC" "$REALTIME" '["StockShortage"]'

touch /tmp/alegra-lunch-ready
echo "alegra-lunch: tables, topics and queues are ready"
