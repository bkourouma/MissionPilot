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
import { exigerPermission } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Simulateur des canaux" };

/**
 * Simulateur (développement) : boîte des messages « envoyés » et formulaire « Message reçu d'un
 * destinataire de test ». Disponible seulement en mode simulé local, pour l'associé : sinon l'API
 * répond 404 et l'écran le dit.
 */
export default async function PageSimulateurCanaux() {
  await exigerPermission("canaux.configurer");
  const r = await chargerServeur<unknown>(API_CANAUX_SIMULATEUR_BOITE);
  const messages: MessageSimulateurApi[] = r.ok ? messagesSimulateur(r.donnees) : [];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Simulateur (développement)"
        soustitre="Ce que les canaux simulés « enverraient », et de quoi leur faire « recevoir » un message. Rien ne quitte CabinetPilot."
      />
      {!r.ok ? (
        simulateurIndisponible(r) ? (
          <EtatVide titre="Le simulateur n'est pas disponible." icone="info">
            <p>
              Il n&apos;existe qu&apos;en mode simulé, sur une installation locale de développement.
            </p>
          </EtatVide>
        ) : (
          <EtatErreur
            titre="La boîte du simulateur n'a pas pu être chargée."
            message={r.message}
            hrefReessayer={CHEMIN_CANAUX_SIMULATEUR}
          />
        )
      ) : (
        <>
          <Carte titre="Message reçu d'un destinataire de test" niveauTitre={2}>
            <FormulaireEntrantSimule
              messages={messages.map((m) => ({
                id_externe: m.id_externe,
                libelle: `${libelleCanal(m.canal)} · ${libelleGabarit(m.gabarit)} · ${m.numero_masque} · ${dateHeureCourte(m.instant)}`,
              }))}
            />
          </Carte>
          <Carte titre="Boîte des messages « envoyés »" niveauTitre={2}>
            {messages.length === 0 ? (
              <EtatVide titre="Aucun message simulé pour le moment." icone="bulle" />
            ) : (
              <ul className="mp-liste-cartes">
                {messages.map((m) => (
                  <li key={m.id_externe}>
                    <p className="mp-texte-doux mp-texte-petit">
                      {`${libelleCanal(m.canal)} · ${libelleGabarit(m.gabarit)} · à ${m.numero_masque} · ${dateHeureCourte(m.instant)}`}
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
