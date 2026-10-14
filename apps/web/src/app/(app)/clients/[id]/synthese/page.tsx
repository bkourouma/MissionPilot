import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ApercuSyntheseApi } from "@missionpilot/shared";
import { BandeauSimule } from "../../../../../components/canaux/BandeauSimule";
import { VueSynthese } from "../../../../../components/canaux/VueSynthese";
import { Alerte } from "../../../../../components/ui/Alerte";
import { classesBouton } from "../../../../../components/ui/Bouton";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { Icone } from "../../../../../components/ui/Icone";
import { Select } from "../../../../../components/ui/Select";
import { chargerServeur } from "../../../../../lib/api-serveur";
import {
  cheminSyntheseClient,
  dirigeantsApercu,
  requeteApercuSynthese,
  TEXTES_CANAUX,
} from "../../../../../lib/canaux";
import { chargerDestinatairesClient } from "../../../../../lib/canaux-serveur";
import type { ClientDetaille } from "../../../../../lib/clients";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { exigerPermission } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Aperçu de la synthèse du dirigeant" };

/**
 * Synthèse hebdomadaire du dirigeant, en APERÇU (CLI-07) : le message WhatsApp tel qu'il
 * partirait et le détail. L'aperçu n'envoie rien et ne crée aucune ligne d'envoi : cet écran n'a
 * aucun bouton d'envoi.
 */
export default async function PageApercuSynthese({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  await exigerPermission("canaux.lire");
  const brut = (await searchParams).destinataire_id;
  const demande = (Array.isArray(brut) ? brut[0] : brut) ?? "";
  const chemin = cheminSyntheseClient(id);

  const [client, destinataires] = await Promise.all([
    chargerServeur<ClientDetaille>(`/api/clients/${id}`),
    chargerDestinatairesClient(id),
  ]);
  if (!client.ok && client.statut === 404) notFound();

  const dirigeants = destinataires.ok ? dirigeantsApercu(destinataires.donnees.elements) : [];
  const destinataireId = dirigeants.some((d) => d.valeur === demande) ? demande : "";
  const apercu = destinataireId
    ? await chargerServeur<ApercuSyntheseApi>(requeteApercuSynthese(id, destinataireId))
    : null;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Synthèse hebdomadaire du dirigeant"
        soustitre={client.ok ? client.donnees.raison_sociale : undefined}
        retour={{ href: `/clients/${id}`, libelle: "Fiche du client" }}
      />
      <BandeauSimule />
      <Alerte tonalite="attention" annonce="aucune" titre={TEXTES_CANAUX.apercuAucunEnvoi}>
        <p>
          Cet écran calcule la synthèse comme le lundi matin, sans rien envoyer ni enregistrer dans
          le journal des envois.
        </p>
      </Alerte>
      {!destinataires.ok ? (
        <EtatErreur
          titre="Les destinataires n'ont pas pu être chargés."
          message={destinataires.message}
          hrefReessayer={chemin}
        />
      ) : dirigeants.length === 0 ? (
        <EtatVide titre="Ce client n'a aucun dirigeant destinataire." icone="personnes">
          <p>
            La synthèse est destinée aux dirigeants du portail du client. Invitez-en un depuis la
            fiche du client, onglet « Portail client ».
          </p>
        </EtatVide>
      ) : (
        <form method="get" action={chemin} className="mp-filtres" aria-label="Choisir le dirigeant">
          <div className="mp-grille-champs mp-grille-champs--filtres">
            <Select
              libelle="Dirigeant destinataire"
              name="destinataire_id"
              defaultValue={destinataireId}
              invite="Choisir un dirigeant…"
              options={dirigeants}
            />
          </div>
          <div className="mp-actions-formulaire">
            <button type="submit" className={classesBouton("primaire")}>
              <Icone nom="oeil" />
              <span>Voir l&apos;aperçu</span>
            </button>
          </div>
        </form>
      )}
      {apercu === null ? null : !apercu.ok ? (
        <EtatErreur
          titre="L'aperçu n'a pas pu être calculé."
          message={apercu.message}
          hrefReessayer={`${chemin}?destinataire_id=${destinataireId}`}
        />
      ) : apercu.donnees.vide || apercu.donnees.texte_message === null ? (
        <EtatVide titre={TEXTES_CANAUX.rienASignaler} icone="succes">
          <p>Il n&apos;y a ni point d&apos;attention ni décision attendue cette semaine.</p>
        </EtatVide>
      ) : (
        <>
          <Carte titre="Message WhatsApp tel qu'il partirait" niveauTitre={2}>
            <p className="mp-canaux__message">{apercu.donnees.texte_message}</p>
          </Carte>
          <Carte titre="Détail affiché dans l'espace du dirigeant" niveauTitre={2}>
            <VueSynthese synthese={apercu.donnees} avecLiens={false} />
          </Carte>
        </>
      )}
    </div>
  );
}
