import type { Metadata } from "next";
import type { MessageSimulateurApi } from "@missionpilot/shared";
import { FormulaireEntrantSimule } from "../../../../../components/canaux/FormulaireEntrantSimule";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import {
  API_CANAUX_SIMULATEUR_BOITE,
  CHEMIN_CANAUX_SIMULATEUR,
  dateHeureCourte,
  libelleCanal,
  libelleGabarit,
  messagesSimulateur,
  simulateurIndisponible,
} from "../../../../../lib/canaux";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Simulateur des canaux", "Channel simulator") };
}

/**
 * Simulateur (développement) : boîte des messages « envoyés » et formulaire « Message reçu d'un
 * destinataire de test ». Disponible seulement en mode simulé local, pour l'associé : sinon l'API
 * répond 404 et l'écran le dit.
 */
export default async function PageSimulateurCanaux() {
  await exigerPermission("canaux.configurer");
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const r = await chargerServeur<unknown>(API_CANAUX_SIMULATEUR_BOITE);
  const messages: MessageSimulateurApi[] = r.ok ? messagesSimulateur(r.donnees) : [];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Simulateur (développement)", "Simulator (development)")}
        soustitre={t(
          "Ce que les canaux simulés « enverraient », et de quoi leur faire « recevoir » un message. Rien ne quitte CabinetPilot.",
          'What the simulated channels would "send", and a way to make them "receive" a message. Nothing leaves CabinetPilot.',
        )}
      />
      {!r.ok ? (
        simulateurIndisponible(r) ? (
          <EtatVide
            titre={t("Le simulateur n'est pas disponible.", "The simulator is not available.")}
            icone="info"
          >
            <p>
              {t(
                "Il n'existe qu'en mode simulé, sur une installation locale de développement.",
                "It only exists in simulated mode, on a local development installation.",
              )}
            </p>
          </EtatVide>
        ) : (
          <EtatErreur
            titre={t(
              "La boîte du simulateur n'a pas pu être chargée.",
              "The simulator mailbox could not be loaded.",
            )}
            message={r.message}
            hrefReessayer={CHEMIN_CANAUX_SIMULATEUR}
          />
        )
      ) : (
        <>
          <Carte
            titre={t(
              "Message reçu d'un destinataire de test",
              "Message received from a test recipient",
            )}
            niveauTitre={2}
          >
            <FormulaireEntrantSimule
              messages={messages.map((m) => ({
                id_externe: m.id_externe,
                libelle: `${libelleCanal(m.canal, langue)} · ${libelleGabarit(m.gabarit, langue)} · ${m.numero_masque} · ${dateHeureCourte(m.instant, langue)}`,
              }))}
            />
          </Carte>
          <Carte
            titre={t("Boîte des messages « envoyés »", 'Mailbox of "sent" messages')}
            niveauTitre={2}
          >
            {messages.length === 0 ? (
              <EtatVide
                titre={t("Aucun message simulé pour le moment.", "No simulated message yet.")}
                icone="bulle"
              />
            ) : (
              <ul className="mp-liste-cartes">
                {messages.map((m) => (
                  <li key={m.id_externe}>
                    <p className="mp-texte-doux mp-texte-petit">
                      {`${libelleCanal(m.canal, langue)} · ${libelleGabarit(m.gabarit, langue)} · ${t("à", "to")} ${m.numero_masque} · ${dateHeureCourte(m.instant, langue)}`}
                    </p>
                    <p className="mp-canaux__message">{m.texte}</p>
                  </li>
                ))}
              </ul>
            )}
          </Carte>
        </>
      )}
    </div>
  );
}
