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
  textesCanaux,
} from "../../../../../lib/canaux";
import { chargerDestinatairesClient } from "../../../../../lib/canaux-serveur";
import type { ClientDetaille } from "../../../../../lib/clients";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Aperçu de la synthèse du dirigeant", "Executive summary preview") };
}

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
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const textes = textesCanaux(langue);
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

  const dirigeants = destinataires.ok
    ? dirigeantsApercu(destinataires.donnees.elements, langue)
    : [];
  const destinataireId = dirigeants.some((d) => d.valeur === demande) ? demande : "";
  const apercu = destinataireId
    ? await chargerServeur<ApercuSyntheseApi>(requeteApercuSynthese(id, destinataireId))
    : null;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Synthèse hebdomadaire du dirigeant", "Weekly executive summary")}
        soustitre={client.ok ? client.donnees.raison_sociale : undefined}
        retour={{ href: `/clients/${id}`, libelle: t("Fiche du client", "Client record") }}
      />
      <BandeauSimule />
      <Alerte tonalite="attention" annonce="aucune" titre={textes.apercuAucunEnvoi}>
        <p>
          {t(
            "Cet écran calcule la synthèse comme le lundi matin, sans rien envoyer ni enregistrer dans le journal des envois.",
            "This screen computes the summary as on Monday morning, without sending anything or recording it in the send log.",
          )}
        </p>
      </Alerte>
      {!destinataires.ok ? (
        <EtatErreur
          titre={t(
            "Les destinataires n'ont pas pu être chargés.",
            "The recipients could not be loaded.",
          )}
          message={destinataires.message}
          hrefReessayer={chemin}
        />
      ) : dirigeants.length === 0 ? (
        <EtatVide
          titre={t(
            "Ce client n'a aucun dirigeant destinataire.",
            "This client has no executive recipient.",
          )}
          icone="personnes"
        >
          <p>
            {t(
              "La synthèse est destinée aux dirigeants du portail du client. Invitez-en un depuis la fiche du client, onglet « Portail client ».",
              'The summary is intended for the executives of the client portal. Invite one from the client record, "Client portal" tab.',
            )}
          </p>
        </EtatVide>
      ) : (
        <form
          method="get"
          action={chemin}
          className="mp-filtres"
          aria-label={t("Choisir le dirigeant", "Choose the executive")}
        >
          <div className="mp-grille-champs mp-grille-champs--filtres">
            <Select
              libelle={t("Dirigeant destinataire", "Executive recipient")}
              name="destinataire_id"
              defaultValue={destinataireId}
              invite={t("Choisir un dirigeant…", "Choose an executive…")}
              options={dirigeants}
            />
          </div>
          <div className="mp-actions-formulaire">
            <button type="submit" className={classesBouton("primaire")}>
              <Icone nom="oeil" />
              <span>{t("Voir l'aperçu", "View the preview")}</span>
            </button>
          </div>
        </form>
      )}
      {apercu === null ? null : !apercu.ok ? (
        <EtatErreur
          titre={t("L'aperçu n'a pas pu être calculé.", "The preview could not be computed.")}
          message={apercu.message}
          hrefReessayer={`${chemin}?destinataire_id=${destinataireId}`}
        />
      ) : apercu.donnees.vide || apercu.donnees.texte_message === null ? (
        <EtatVide titre={textes.rienASignaler} icone="succes">
          <p>
            {t(
              "Il n'y a ni point d'attention ni décision attendue cette semaine.",
              "There is no point of attention or pending decision this week.",
            )}
          </p>
        </EtatVide>
      ) : (
        <>
          <Carte
            titre={t(
              "Message WhatsApp tel qu'il partirait",
              "WhatsApp message as it would be sent",
            )}
            niveauTitre={2}
          >
            <p className="mp-canaux__message">{apercu.donnees.texte_message}</p>
          </Carte>
          <Carte
            titre={t(
              "Détail affiché dans l'espace du dirigeant",
              "Details shown in the executive's space",
            )}
            niveauTitre={2}
          >
            <VueSynthese synthese={apercu.donnees} avecLiens={false} />
          </Carte>
        </>
      )}
    </div>
  );
}
